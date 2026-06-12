import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() } }));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => { await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); }); return () => server.close(); });
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers } });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('GET /resident/unit', () => {
  it('requires a resident token', async () => {
    expect((await request('GET', '/api/v1/resident/unit')).status).toBe(401);
  });

  it('returns the unit profile aggregate', async () => {
    queryOne.mockResolvedValueOnce({ unit_number: 'A-204', floor: 2, wing: 'A', ownership_type: 'owner', community_name: 'Green Valley' });
    queryRows
      .mockResolvedValueOnce([
        { id: 'm1', name: 'Prabakaran', relationship: null, is_primary: true, face_enrolled: true, app_access: true },
        { id: 'm2', name: 'Arjun', relationship: 'child', is_primary: false, face_enrolled: false, app_access: true },
      ])
      .mockResolvedValueOnce([
        { id: 'v1', plate_display: 'KA01AB1234', plate: 'KA01AB1234', make: 'Maruti', model: 'Swift', type: 'car', fastag_linked: true },
      ])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador' }])
      .mockResolvedValueOnce([{ base_amount: 4000, penalty_amount: 500 }]);
    const { status, json } = await request('GET', '/api/v1/resident/unit', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.unit).toEqual({ unitNumber: 'A-204', floor: 2, wing: 'A', ownershipType: 'owner', communityName: 'Green Valley', verified: true });
    expect(json.data.members).toHaveLength(2);
    expect(json.data.members[0]).toEqual({ id: 'm1', name: 'Prabakaran', relationship: null, isPrimary: true, faceEnrolled: true, appAccess: true });
    expect(json.data.members[1].faceEnrolled).toBe(false);
    expect(json.data.vehicles[0]).toEqual({ id: 'v1', plate: 'KA01AB1234', makeModel: 'Maruti Swift', type: 'car', fastagLinked: true });
    expect(json.data.pets[0]).toEqual({ id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador' });
    expect(json.data.dues).toEqual({ outstanding: 4500, pendingCount: 1 });
  });
});
