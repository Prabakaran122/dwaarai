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
const { queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryRows.mockReset(); });

async function request(method, path, { headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1' });

describe('GET /units/lookup', () => {
  it('requires a guard token', async () => {
    expect((await request('GET', '/api/v1/units/lookup?q=A-2')).status).toBe(401);
    expect((await request('GET', '/api/v1/units/lookup?q=A-2', { headers: { Authorization: `Bearer ${resident}` } })).status).toBe(403);
  });

  it('requires a query of at least 2 characters', async () => {
    const { status } = await request('GET', '/api/v1/units/lookup?q=A', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(400);
  });

  it('returns matched units with their primary resident (NAZ-024)', async () => {
    queryRows.mockResolvedValueOnce([
      { unit_id: 'u1', unit_number: 'A-204', resident_name: 'Asha Rao', relationship: 'owner', mobile: '9900000000' },
    ]);
    const { status, json } = await request('GET', '/api/v1/units/lookup?q=A-204', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toEqual({ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' });
    // scoped to the guard's own community
    expect(queryRows.mock.calls[0][1][0]).toBe('c1');
  });

  it('returns an empty list rather than an error for no matches', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/units/lookup?q=ZZ-999', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });
});
