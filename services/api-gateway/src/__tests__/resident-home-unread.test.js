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
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

// Order of queryOne calls in resident-home.js: visitors, parcels, helpers,
// notice, upcoming event, then the unread-count section (last, appended).
function seedHappyPath(unreadCount) {
  queryOne
    .mockResolvedValueOnce({ c: 2 }) // visitors
    .mockResolvedValueOnce({ c: 1 }) // parcels
    .mockResolvedValueOnce({ expected: 3, arrived: 1 }) // helpers
    .mockResolvedValueOnce(null) // pinned notice
    .mockResolvedValueOnce(null) // upcoming event
    .mockResolvedValueOnce({ c: unreadCount }); // unread count
  queryRows
    .mockResolvedValueOnce([]) // recent activity
    .mockResolvedValueOnce([]); // dues
}

describe('GET /resident/home — unreadCount', () => {
  it('returns the sum of pending approval requests and waiting deliveries owed to this unit', async () => {
    seedHappyPath(3);
    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.unreadCount).toBe(3);

    // Confirm the query is scoped to the caller's own community + unit and
    // only counts still-pending, still-unexpired approvals plus deliveries
    // genuinely waiting at the gate.
    const unreadCall = queryOne.mock.calls[5];
    expect(unreadCall[0]).toMatch(/approval_requests/);
    expect(unreadCall[0]).toMatch(/status = 'pending'/);
    expect(unreadCall[0]).toMatch(/expires_at > NOW\(\)/);
    expect(unreadCall[0]).toMatch(/deliveries/);
    expect(unreadCall[0]).toMatch(/status = 'waiting'/);
    expect(unreadCall[1]).toEqual(['c1', 'u1']);
  });

  it('returns 0 when there is nothing pending', async () => {
    seedHappyPath(0);
    const { json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(json.data.unreadCount).toBe(0);
  });

  it('degrades to 0 when the unread-count query fails, without touching the rest of the response', async () => {
    queryOne
      .mockResolvedValueOnce({ c: 2 }) // visitors
      .mockResolvedValueOnce({ c: 1 }) // parcels
      .mockResolvedValueOnce({ expected: 3, arrived: 1 }) // helpers
      .mockResolvedValueOnce(null) // pinned notice
      .mockResolvedValueOnce(null) // upcoming event
      .mockRejectedValueOnce(new Error('db down')); // unread count
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.unreadCount).toBe(0);
    // The rest of the aggregate is unaffected by the failure.
    expect(json.data.gateGlance).toEqual({
      visitors: { expected: 2 },
      parcels: { pending: 1 },
      helpers: { expected: 3, arrived: 1 },
    });
  });
});
