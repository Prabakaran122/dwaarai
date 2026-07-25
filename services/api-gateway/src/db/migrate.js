#!/usr/bin/env node
/**
 * SQL migration runner.
 *
 * Migrations are the numbered .sql files in services/api-gateway/migrations/,
 * applied in filename order and recorded in a `schema_migrations` table so each
 * one runs exactly once. Until this existed they were applied by hand, which is
 * how migration 031 could sit unapplied while the code that needed it shipped.
 *
 *   node src/db/migrate.js                     # apply everything pending
 *   node src/db/migrate.js --dry-run           # list what WOULD run
 *   node src/db/migrate.js --baseline 030_staff_access_windows.sql
 *   node src/db/migrate.js --allow-drift       # accept edited applied files
 *
 * ADOPTING AN EXISTING DATABASE
 * Databases provisioned before this runner already have their tables but no
 * `schema_migrations` rows. Re-running 001 against them would fail (or worse),
 * so the runner REFUSES to touch a populated database it has no record of, and
 * tells you to baseline it: `--baseline <last-applied-file>` records everything
 * up to and including that file as applied WITHOUT executing it. A genuinely
 * empty database needs no baseline — it just runs from 001.
 *
 * Each migration runs inside its own transaction (Postgres DDL is
 * transactional), so a failure rolls back cleanly and later migrations are left
 * pending. A file needing to run outside a transaction — CREATE INDEX
 * CONCURRENTLY, say — must declare `-- migrate:no-transaction` on any line.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Any 64-bit constant; shared by every runner so concurrent deploys queue up
// instead of racing to apply the same file twice.
const ADVISORY_LOCK_KEY = 8823147650021n;

const NO_TXN_MARKER = '-- migrate:no-transaction';

/** sha256 of the file, newline-normalised so a CRLF checkout doesn't read as drift. */
export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function listMigrations(dir = DEFAULT_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()                                  // 001_… 002_… — zero-padded, so lexical == numeric
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), 'utf8');
      return {
        filename,
        sql,
        checksum: checksum(sql),
        transactional: !sql.includes(NO_TXN_MARKER),
      };
    });
}

/**
 * Apply pending migrations.
 *
 * @param {object}   opts
 * @param {object}   opts.client      pg Client (anything with .query())
 * @param {string}  [opts.dir]        migrations directory
 * @param {string}  [opts.baseline]   filename to adopt up to, or 'latest' for all
 * @param {boolean} [opts.dryRun]     report without applying
 * @param {boolean} [opts.allowDrift] update the recorded checksum instead of failing
 * @param {Function}[opts.log]
 * @returns {Promise<{applied: string[], pending: string[], baselined: string[]}>}
 */
export async function runMigrations({
  client, dir = DEFAULT_DIR, baseline = null,
  dryRun = false, allowDrift = false, log = console.log,
}) {
  const migrations = listMigrations(dir);
  if (!migrations.length) {
    log('No migration files found.');
    return { applied: [], pending: [], baselined: [] };
  }

  await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
  try {
    const firstRun = !(await tableExists(client, 'schema_migrations'));
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    // A database with app tables but no migration history predates this runner.
    // Refuse rather than replay 001 over live data.
    if (firstRun && applied.size === 0 && !baseline && (await tableExists(client, 'communities'))) {
      throw new Error(
        'This database already has tables but no schema_migrations history, so it was\n' +
        'provisioned before the migration runner existed. Re-running 001 would fail or\n' +
        'damage it. Record the migrations already applied by hand, then run again:\n\n' +
        `    node src/db/migrate.js --baseline <last-applied-file>\n\n` +
        `Available: ${migrations[0].filename} … ${migrations[migrations.length - 1].filename}\n` +
        'Use --baseline latest only if EVERY file above is already applied.'
      );
    }

    const baselined = [];
    if (baseline) {
      const cutoff = baseline === 'latest'
        ? migrations.length - 1
        : migrations.findIndex((m) => m.filename === baseline);
      if (cutoff < 0) throw new Error(`--baseline: no such migration '${baseline}'`);
      for (const m of migrations.slice(0, cutoff + 1)) {
        if (applied.has(m.filename)) continue;
        if (!dryRun) {
          await client.query(
            'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
            [m.filename, m.checksum]
          );
        }
        applied.set(m.filename, m.checksum);
        baselined.push(m.filename);
      }
      log(`Baselined ${baselined.length} migration(s) as already applied (not executed).`);
    }

    // An applied file whose contents changed means the DB and the repo disagree
    // about what's in the schema — worth stopping for.
    const drifted = migrations.filter(
      (m) => applied.has(m.filename) && applied.get(m.filename) !== m.checksum
    );
    if (drifted.length) {
      const names = drifted.map((m) => m.filename).join(', ');
      if (!allowDrift) {
        throw new Error(
          `Already-applied migration(s) have been edited since they ran: ${names}\n` +
          'The database no longer matches the repo. Write a NEW migration for the change,\n' +
          'or re-run with --allow-drift if the edit was cosmetic (comments/whitespace).'
        );
      }
      log(`WARNING: accepting edited migration(s): ${names}`);
      for (const m of drifted) {
        if (!dryRun) {
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE filename = $2',
            [m.checksum, m.filename]);
        }
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.filename));
    if (!pending.length) {
      log(`Database is up to date (${applied.size} migration(s) applied).`);
      return { applied: [], pending: [], baselined };
    }

    if (dryRun) {
      log(`${pending.length} migration(s) pending:`);
      for (const m of pending) log(`  - ${m.filename}`);
      return { applied: [], pending: pending.map((m) => m.filename), baselined };
    }

    const done = [];
    for (const m of pending) {
      const started = Date.now();
      if (m.transactional) await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [m.filename, m.checksum]
        );
        if (m.transactional) await client.query('COMMIT');
      } catch (err) {
        if (m.transactional) {
          await client.query('ROLLBACK').catch(() => {});
          log(`FAILED ${m.filename} (rolled back): ${err.message}`);
        } else {
          // Ran outside a transaction, so the database may be half-changed.
          log(`FAILED ${m.filename} — ran with ${NO_TXN_MARKER}, so partial changes may ` +
              `remain and need manual cleanup: ${err.message}`);
        }
        err.migration = m.filename;
        throw err;
      }
      done.push(m.filename);
      log(`applied ${m.filename} (${Date.now() - started}ms)`);
    }
    log(`Applied ${done.length} migration(s).`);
    return { applied: done, pending: [], baselined };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`).catch(() => {});
  }
}

async function tableExists(client, name) {
  const { rows } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS present', [`public.${name}`]
  );
  return Boolean(rows[0]?.present);
}

function parseArgs(argv) {
  const opts = { dryRun: false, allowDrift: false, baseline: null, dir: DEFAULT_DIR };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run': opts.dryRun = true; break;
      case '--allow-drift': opts.allowDrift = true; break;
      case '--baseline': opts.baseline = argv[++i]; break;
      case '--dir': opts.dir = resolve(argv[++i]); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (opts.baseline === undefined) throw new Error('--baseline needs a filename (or "latest")');
  return opts;
}

const USAGE = `
Apply pending SQL migrations.

  node src/db/migrate.js [--dry-run] [--baseline <file|latest>] [--allow-drift] [--dir <path>]

Requires DATABASE_URL. See the header of this file for adopting an existing database.
`;

// Entry point — only when run directly, so tests can import the functions.
// pathToFileURL rather than string-building: a Windows path ('C:\...') has to
// become 'file:///C:/...', which naive concatenation gets wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations({ ...opts, client });
  } catch (err) {
    console.error(`\nMigration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
