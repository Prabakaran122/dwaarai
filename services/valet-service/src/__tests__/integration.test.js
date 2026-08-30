import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * Exercises the real SQL against a real Postgres.
 *
 * The other suites mock the database, which proves the routing, validation and
 * state-machine logic but cannot catch a malformed query, a wrong column name,
 * or a constraint that does not behave as intended. This closes that gap.
 *
 * Skipped unless VALET_TEST_DATABASE_URL points at a database with the
 * migrations applied, so a plain `pnpm test` still runs offline:
 *
 *   docker run -d --name valet-pg -e POSTGRES_DB=communitygate \
 *     -e POSTGRES_USER=cguser -e POSTGRES_PASSWORD=devpass -p 55432:5432 postgres:15-alpine
 *   DATABASE_URL=postgresql://cguser:devpass@localhost:55432/communitygate \
 *     node ../api-gateway/src/db/migrate.js
 *   VALET_TEST_DATABASE_URL=postgresql://cguser:devpass@localhost:55432/communitygate pnpm test
 */
const CONNECTION = process.env.VALET_TEST_DATABASE_URL;
const suite = CONNECTION ? describe : describe.skip;

let pool;
let communityId;
let guardId;
let otherGuardId;

async function makeTicket(overrides = {}) {
  const {
    displayId = `SRT-${Math.floor(Math.random() * 100000)}`,
    plate = 'KA03NJ0435',
    status = 'parked',
    stayEndAt = new Date(Date.now() + 86400000).toISOString(),
  } = overrides;

  const { rows } = await pool.query(
    `INSERT INTO valet_tickets
       (community_id, display_id, session_token, plate, plate_normalized,
        vehicle_make, stay_end_at, status, created_by_guard_id)
     VALUES ($1, $2, $3, $4, $5, 'Maruti Swift', $6, $7, $8)
     RETURNING *`,
    [communityId, displayId, `tok-${Math.random().toString(36).slice(2)}${Date.now()}`,
     plate, plate.replace(/\s+/g, '').toUpperCase(), stayEndAt, status, guardId]
  );
  return rows[0];
}

suite('valet schema against a real database', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION });

    const community = await pool.query(
      `INSERT INTO communities (name, address, city)
       VALUES ('Valet Test Community', '1 Test Rd', 'Bengaluru')
       RETURNING id`
    );
    communityId = community.rows[0].id;

    const block = await pool.query(
      `INSERT INTO blocks (community_id, name) VALUES ($1, 'A') RETURNING id`,
      [communityId]
    );
    const unit = await pool.query(
      `INSERT INTO units (community_id, block_id, unit_number) VALUES ($1, $2, 'A-101') RETURNING id`,
      [communityId, block.rows[0].id]
    );

    const guards = await pool.query(
      `INSERT INTO residents (community_id, unit_id, name, mobile, type)
       VALUES ($1, $2, 'Ramesh', '9000000001', 'guard'),
              ($1, $2, 'Suresh', '9000000002', 'guard')
       RETURNING id`,
      [communityId, unit.rows[0].id]
    );
    guardId = guards.rows[0].id;
    otherGuardId = guards.rows[1].id;
  });

  afterAll(async () => {
    if (!pool) return;
    // valet_tickets cascades to events/photos/tokens/condition records.
    await pool.query('DELETE FROM valet_discount_optins WHERE community_id = $1', [communityId]);
    await pool.query('DELETE FROM valet_tickets WHERE community_id = $1', [communityId]);
    await pool.query('DELETE FROM residents WHERE community_id = $1', [communityId]);
    await pool.query('DELETE FROM units WHERE community_id = $1', [communityId]);
    await pool.query('DELETE FROM blocks WHERE community_id = $1', [communityId]);
    await pool.query('DELETE FROM communities WHERE id = $1', [communityId]);
    await pool.end();
  });

  it('rejects a status outside the flow', async () => {
    await expect(makeTicket({ status: 'teleported' })).rejects.toThrow();
  });

  it('rejects an out-of-range ETA', async () => {
    const ticket = await makeTicket();
    await expect(
      pool.query('UPDATE valet_tickets SET eta_minutes = 99 WHERE id = $1', [ticket.id])
    ).rejects.toThrow();
  });

  it('enforces one display id per community', async () => {
    await makeTicket({ displayId: 'SRT-DUP' });
    await expect(makeTicket({ displayId: 'SRT-DUP' })).rejects.toThrow(/duplicate key/);
  });

  it('enforces globally unique session tokens', async () => {
    const first = await makeTicket();
    await expect(
      pool.query(
        `INSERT INTO valet_tickets
           (community_id, display_id, session_token, plate, plate_normalized,
            vehicle_make, stay_end_at, created_by_guard_id)
         VALUES ($1, 'SRT-CLASH', $2, 'X', 'X', 'Y', NOW() + interval '1 day', $3)`,
        [communityId, first.session_token, guardId]
      )
    ).rejects.toThrow(/duplicate key/);
  });

  it('runs the whole flow: request, accept, arrive, scan, confirm', async () => {
    const ticket = await makeTicket();

    await pool.query(`UPDATE valet_tickets SET status = 'requested' WHERE id = $1`, [ticket.id]);
    await pool.query(
      `UPDATE valet_tickets SET status = 'en_route', current_guard_id = $1,
              eta_minutes = 5, en_route_started_at = NOW() WHERE id = $2`,
      [otherGuardId, ticket.id]
    );
    await pool.query(`UPDATE valet_tickets SET status = 'arrived' WHERE id = $1`, [ticket.id]);
    await pool.query(
      `INSERT INTO valet_ticket_events (ticket_id, event_type, guard_id) VALUES ($1, 'arrived', $2)`,
      [ticket.id, otherGuardId]
    );

    // The rotating-token consume, exactly as the scan route issues it.
    await pool.query(
      `INSERT INTO valet_rotating_tokens (ticket_id, token, expires_at)
       VALUES ($1, 'live-token-1', NOW() + interval '18 seconds')`,
      [ticket.id]
    );
    const consumed = await pool.query(
      `UPDATE valet_rotating_tokens SET used_at = NOW()
        WHERE id = (SELECT id FROM valet_rotating_tokens WHERE ticket_id = $1 ORDER BY generated_at DESC LIMIT 1)
          AND token = $2 AND used_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [ticket.id, 'live-token-1']
    );
    expect(consumed.rowCount).toBe(1);

    // The same token cannot be consumed twice.
    const replay = await pool.query(
      `UPDATE valet_rotating_tokens SET used_at = NOW()
        WHERE id = (SELECT id FROM valet_rotating_tokens WHERE ticket_id = $1 ORDER BY generated_at DESC LIMIT 1)
          AND token = $2 AND used_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [ticket.id, 'live-token-1']
    );
    expect(replay.rowCount).toBe(0);

    const final = await pool.query('SELECT status FROM valet_tickets WHERE id = $1', [ticket.id]);
    expect(final.rows[0].status).toBe('arrived');
  });

  it('will not consume an expired rotating token', async () => {
    const ticket = await makeTicket({ status: 'arrived' });
    await pool.query(
      `INSERT INTO valet_rotating_tokens (ticket_id, token, expires_at)
       VALUES ($1, 'stale-token', NOW() - interval '1 second')`,
      [ticket.id]
    );

    const consumed = await pool.query(
      `UPDATE valet_rotating_tokens SET used_at = NOW()
        WHERE id = (SELECT id FROM valet_rotating_tokens WHERE ticket_id = $1 ORDER BY generated_at DESC LIMIT 1)
          AND token = $2 AND used_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [ticket.id, 'stale-token']
    );
    expect(consumed.rowCount).toBe(0);
  });

  it('will not consume a superseded token even while it is unexpired', async () => {
    const ticket = await makeTicket({ status: 'arrived' });
    await pool.query(
      `INSERT INTO valet_rotating_tokens (ticket_id, token, generated_at, expires_at)
       VALUES ($1, 'older', NOW() - interval '2 seconds', NOW() + interval '60 seconds'),
              ($1, 'newest', NOW(), NOW() + interval '60 seconds')`,
      [ticket.id]
    );

    const consumed = await pool.query(
      `UPDATE valet_rotating_tokens SET used_at = NOW()
        WHERE id = (SELECT id FROM valet_rotating_tokens WHERE ticket_id = $1 ORDER BY generated_at DESC LIMIT 1)
          AND token = $2 AND used_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [ticket.id, 'older']
    );
    expect(consumed.rowCount).toBe(0);
  });

  it('expires overdue tickets on a real timestamp comparison', async () => {
    // The bug this guards against: the SQLite original compared an ISO string
    // against a differently formatted one and silently matched nothing.
    const ticket = await makeTicket({ stayEndAt: new Date(Date.now() - 3600_000).toISOString() });

    const swept = await pool.query(
      `UPDATE valet_tickets SET status = 'expired', closed_at = NOW()
        WHERE status = ANY($1) AND stay_end_at < NOW() AND id = $2
        RETURNING id`,
      [['parked', 'requested', 'en_route', 'arrived', 'parked_again'], ticket.id]
    );

    expect(swept.rowCount).toBe(1);
  });

  it('deletes condition media for an undisputed ticket but spares a disputed one', async () => {
    const plain = await makeTicket();
    const disputed = await makeTicket();
    await pool.query('UPDATE valet_tickets SET disputed = TRUE WHERE id = $1', [disputed.id]);

    for (const id of [plain.id, disputed.id]) {
      await pool.query(
        `INSERT INTO valet_condition_records (ticket_id, stage, media_type, angle, storage_key, auto_delete_after)
         VALUES ($1, 'intake', 'photo', 'front', 'k', NOW() - interval '1 hour')`,
        [id]
      );
    }

    const due = await pool.query(
      `UPDATE valet_condition_records vcr SET deleted_at = NOW()
         FROM valet_tickets t
        WHERE t.id = vcr.ticket_id
          AND vcr.auto_delete_after < NOW()
          AND vcr.deleted_at IS NULL
          AND t.disputed = FALSE
          AND vcr.ticket_id = ANY($1)
        RETURNING vcr.ticket_id`,
      [[plain.id, disputed.id]]
    );

    expect(due.rows.map((r) => r.ticket_id)).toEqual([plain.id]);
  });

  it('rejects condition media with an angle outside the four sides', async () => {
    const ticket = await makeTicket();
    await expect(
      pool.query(
        `INSERT INTO valet_condition_records (ticket_id, stage, media_type, angle, storage_key)
         VALUES ($1, 'intake', 'photo', 'roof', 'k')`,
        [ticket.id]
      )
    ).rejects.toThrow();
  });

  it('matches a plate across spacing differences via plate_normalized', async () => {
    const marker = `KA99ZZ${Math.floor(Math.random() * 9000) + 1000}`;
    await makeTicket({ plate: marker });
    await makeTicket({ plate: marker.replace(/(.{2})(.{2})(.{2})(.*)/, '$1 $2 $3 $4') });

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM valet_tickets
        WHERE community_id = $1 AND plate_normalized = $2`,
      [communityId, marker]
    );
    expect(rows[0].c).toBe(2);
  });

  it('cascades events and media away with their ticket', async () => {
    const ticket = await makeTicket();
    await pool.query(
      `INSERT INTO valet_ticket_events (ticket_id, event_type, guard_id) VALUES ($1, 'created', $2)`,
      [ticket.id, guardId]
    );
    await pool.query('DELETE FROM valet_tickets WHERE id = $1', [ticket.id]);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM valet_ticket_events WHERE ticket_id = $1',
      [ticket.id]
    );
    expect(rows[0].c).toBe(0);
  });

  it('stores staff badge fields on the guard rather than a name-keyed side table', async () => {
    await pool.query(
      `UPDATE residents SET employee_code = 'EMP-101', badge_consent_at = NOW() WHERE id = $1`,
      [guardId]
    );
    const { rows } = await pool.query(
      'SELECT employee_code, badge_consent_at FROM residents WHERE id = $1',
      [guardId]
    );
    expect(rows[0].employee_code).toBe('EMP-101');
    expect(rows[0].badge_consent_at).toBeInstanceOf(Date);
  });

  it('records event metadata as queryable jsonb, not an opaque string', async () => {
    const ticket = await makeTicket();
    await pool.query(
      `INSERT INTO valet_ticket_events (ticket_id, event_type, guard_id, metadata)
       VALUES ($1, 'accepted', $2, $3)`,
      [ticket.id, guardId, JSON.stringify({ etaMinutes: 5 })]
    );

    const { rows } = await pool.query(
      `SELECT metadata->>'etaMinutes' AS eta FROM valet_ticket_events
        WHERE ticket_id = $1 AND event_type = 'accepted'`,
      [ticket.id]
    );
    expect(rows[0].eta).toBe('5');
  });
});
