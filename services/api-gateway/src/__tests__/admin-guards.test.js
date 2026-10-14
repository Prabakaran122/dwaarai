import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); });

const COMMUNITY = '00000000-0000-0000-0000-000000000001';
const superAdmin = generateTestToken({ sub: 'sa1', role: 'super_admin', community_id: null });

describe('POST /admin/guards', () => {
  // units.floor is INT. The GUARD-POST unit was inserted with floor 'G', so
  // Postgres rejected it and the FIRST guard of every community 500'd --
  // the same bug valet-service's staff route had already fixed.
  it('creates the GUARD-POST unit with no floor rather than a non-integer one', async () => {
    queryOne
      .mockResolvedValueOnce(null)                 // no existing guard with this mobile
      .mockResolvedValueOnce(null)                 // no GUARD-POST unit yet
      .mockResolvedValueOnce({ id: 'unit-1' })     // unit created
      .mockResolvedValueOnce({ id: 'g1', name: 'Ramesh' });

    const res = await fetch(`${baseUrl}/api/v1/admin/guards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin}` },
      body: JSON.stringify({ name: 'Ramesh', mobile: '9000000001', password: 'guard123', community_id: COMMUNITY }),
    });

    expect(res.status).toBe(201);
    const [unitSql, unitParams] = queryOne.mock.calls[2];
    expect(unitSql).toMatch(/INSERT INTO units/);
    expect(unitSql).not.toMatch(/'G'/);
    expect(unitSql).toMatch(/NULL/);
    expect(unitParams).toEqual([COMMUNITY]);
  });
});
