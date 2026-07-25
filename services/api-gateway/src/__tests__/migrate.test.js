/**
 * Migration runner tests.
 *
 * Driven by a fake pg client that keeps just enough state — which tables exist
 * and what's in schema_migrations — to exercise the real decision logic:
 * ordering, once-only application, adoption of a pre-existing database,
 * checksum drift, rollback, and locking. Real SQL execution against Postgres is
 * covered by the `migrations` CI job, which runs every file against a fresh
 * database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { runMigrations, checksum, listMigrations } = await import('../db/migrate.js');

class FakeClient {
  constructor({ tables = [], migrations = [], failOn = null } = {}) {
    this.tables = new Set(tables);
    this.rows = migrations.map(([filename, sum]) => ({ filename, checksum: sum }));
    this.failOn = failOn;
    this.executed = [];   // migration bodies, in order
    this.commands = [];   // every statement, for lock/txn assertions
  }

  async query(sql, params = []) {
    this.commands.push(sql.trim().split('\n')[0].trim());

    if (/pg_advisory_(un)?lock/.test(sql)) return { rows: [] };
    if (/to_regclass/.test(sql)) {
      const name = String(params[0]).replace('public.', '');
      return { rows: [{ present: this.tables.has(name) }] };
    }
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) {
      this.tables.add('schema_migrations');
      return { rows: [] };
    }
    if (/SELECT filename, checksum FROM schema_migrations/.test(sql)) {
      return { rows: [...this.rows] };
    }
    if (/INSERT INTO schema_migrations/.test(sql)) {
      this.rows.push({ filename: params[0], checksum: params[1] });
      return { rows: [] };
    }
    if (/UPDATE schema_migrations SET checksum/.test(sql)) {
      const row = this.rows.find((r) => r.filename === params[1]);
      if (row) row.checksum = params[0];
      return { rows: [] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };

    // Anything else is a migration body.
    this.executed.push(sql.trim());
    if (this.failOn && sql.includes(this.failOn)) throw new Error('syntax error at or near "oops"');
    return { rows: [] };
  }
}

let dir;
const write = (name, sql) => writeFileSync(join(dir, name), sql);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cg-migrations-'));
  write('001_core.sql', 'CREATE TABLE communities (id INT);\n');
  write('002_gates.sql', 'CREATE TABLE gates (id INT);\n');
  write('003_events.sql', 'CREATE TABLE gate_events (id INT);\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const silent = () => {};

describe('migration runner', () => {
  it('applies every migration in filename order on a fresh database', async () => {
    const client = new FakeClient();
    const res = await runMigrations({ client, dir, log: silent });

    expect(res.applied).toEqual(['001_core.sql', '002_gates.sql', '003_events.sql']);
    expect(client.executed).toEqual([
      'CREATE TABLE communities (id INT);',
      'CREATE TABLE gates (id INT);',
      'CREATE TABLE gate_events (id INT);',
    ]);
  });

  it('records what it applied so a second run is a no-op', async () => {
    const client = new FakeClient();
    await runMigrations({ client, dir, log: silent });
    const before = client.executed.length;

    const res = await runMigrations({ client, dir, log: silent });
    expect(res.applied).toEqual([]);
    expect(client.executed).toHaveLength(before); // nothing re-run
  });

  it('applies only the migrations added since the last run', async () => {
    const client = new FakeClient();
    await runMigrations({ client, dir, log: silent });

    write('004_new.sql', 'ALTER TABLE gates ADD COLUMN note TEXT;\n');
    const res = await runMigrations({ client, dir, log: silent });

    expect(res.applied).toEqual(['004_new.sql']);
    expect(client.executed.at(-1)).toBe('ALTER TABLE gates ADD COLUMN note TEXT;');
  });

  it('--dry-run reports pending work without touching the database', async () => {
    const client = new FakeClient();
    const res = await runMigrations({ client, dir, dryRun: true, log: silent });

    expect(res.pending).toEqual(['001_core.sql', '002_gates.sql', '003_events.sql']);
    expect(res.applied).toEqual([]);
    expect(client.executed).toEqual([]);
    expect(client.rows).toEqual([]);
  });

  describe('adopting a database created before the runner existed', () => {
    it('refuses to replay migrations over existing tables', async () => {
      const client = new FakeClient({ tables: ['communities'] });
      await expect(runMigrations({ client, dir, log: silent }))
        .rejects.toThrow(/no schema_migrations history/);
      expect(client.executed).toEqual([]); // critically, 001 did NOT re-run
    });

    it('--baseline records files as applied without executing them', async () => {
      const client = new FakeClient({ tables: ['communities'] });
      const res = await runMigrations({ client, dir, baseline: '002_gates.sql', log: silent });

      expect(res.baselined).toEqual(['001_core.sql', '002_gates.sql']);
      expect(res.applied).toEqual(['003_events.sql']);      // only the genuinely pending one ran
      expect(client.executed).toEqual(['CREATE TABLE gate_events (id INT);']);
    });

    it('--baseline latest adopts everything', async () => {
      const client = new FakeClient({ tables: ['communities'] });
      const res = await runMigrations({ client, dir, baseline: 'latest', log: silent });

      expect(res.baselined).toHaveLength(3);
      expect(res.applied).toEqual([]);
      expect(client.executed).toEqual([]);
    });

    it('rejects a baseline naming a file that does not exist', async () => {
      const client = new FakeClient({ tables: ['communities'] });
      await expect(runMigrations({ client, dir, baseline: '999_nope.sql', log: silent }))
        .rejects.toThrow(/no such migration/);
    });

    it('needs no baseline when the database is genuinely empty', async () => {
      const client = new FakeClient({ tables: [] });
      const res = await runMigrations({ client, dir, log: silent });
      expect(res.applied).toHaveLength(3);
    });
  });

  describe('checksum drift', () => {
    it('fails when an already-applied migration has been edited', async () => {
      const client = new FakeClient();
      await runMigrations({ client, dir, log: silent });

      write('002_gates.sql', 'CREATE TABLE gates (id INT, extra TEXT);\n');
      await expect(runMigrations({ client, dir, log: silent }))
        .rejects.toThrow(/edited since they ran/);
    });

    it('--allow-drift re-records the checksum instead of failing', async () => {
      const client = new FakeClient();
      await runMigrations({ client, dir, log: silent });

      const edited = 'CREATE TABLE gates (id INT); -- clarifying comment\n';
      write('002_gates.sql', edited);
      await runMigrations({ client, dir, allowDrift: true, log: silent });

      expect(client.rows.find((r) => r.filename === '002_gates.sql').checksum)
        .toBe(checksum(edited));
    });

    it('does not treat a CRLF checkout as drift', () => {
      expect(checksum('CREATE TABLE x (id INT);\n'))
        .toBe(checksum('CREATE TABLE x (id INT);\r\n'));
    });
  });

  describe('failure handling', () => {
    it('rolls back the failing migration and leaves later ones pending', async () => {
      write('002_gates.sql', 'CREATE oops;\n');
      const client = new FakeClient({ failOn: 'oops' });

      await expect(runMigrations({ client, dir, log: silent })).rejects.toThrow(/syntax error/);
      expect(client.commands).toContain('ROLLBACK');
      // 001 committed; 002 rolled back; 003 never attempted.
      expect(client.rows.map((r) => r.filename)).toEqual(['001_core.sql']);
      expect(client.executed).not.toContain('CREATE TABLE gate_events (id INT);');
    });

    it('releases the advisory lock even when a migration fails', async () => {
      write('002_gates.sql', 'CREATE oops;\n');
      const client = new FakeClient({ failOn: 'oops' });

      await expect(runMigrations({ client, dir, log: silent })).rejects.toThrow();
      expect(client.commands.some((c) => c.includes('pg_advisory_unlock'))).toBe(true);
    });

    it('takes an advisory lock so concurrent deploys cannot race', async () => {
      const client = new FakeClient();
      await runMigrations({ client, dir, log: silent });
      expect(client.commands[0]).toMatch(/pg_advisory_lock/);
      expect(client.commands.at(-1)).toMatch(/pg_advisory_unlock/);
    });
  });

  it('runs a -- migrate:no-transaction file outside a transaction', async () => {
    rmSync(join(dir, '002_gates.sql'));
    rmSync(join(dir, '003_events.sql'));
    write('002_concurrent.sql',
      '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY idx ON communities (id);\n');

    const client = new FakeClient();
    await runMigrations({ client, dir, log: silent });

    // 001 is transactional, 002 is not — so exactly one BEGIN/COMMIT pair.
    expect(client.commands.filter((c) => c === 'BEGIN')).toHaveLength(1);
    expect(client.commands.filter((c) => c === 'COMMIT')).toHaveLength(1);
  });

  describe('the real migrations directory', () => {
    it('is ordered, uniquely numbered and non-empty', () => {
      const real = listMigrations();
      expect(real.length).toBeGreaterThan(0);

      const numbers = real.map((m) => m.filename.slice(0, 3));
      expect(numbers).toEqual([...numbers].sort());          // filename order == numeric order
      expect(new Set(numbers).size).toBe(numbers.length);     // no duplicate prefixes
      expect(real.every((m) => /^\d{3}_/.test(m.filename))).toBe(true);
    });
  });
});
