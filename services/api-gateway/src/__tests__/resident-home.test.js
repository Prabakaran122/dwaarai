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

function seedHappyPath() {
  queryOne
    .mockResolvedValueOnce({ c: 2 })
    .mockResolvedValueOnce({ c: 1 })
    .mockResolvedValueOnce({ expected: 3, arrived: 1 })
    .mockResolvedValueOnce({ id: 'n1', title: 'Water cut 6pm', author_name: 'RWA', created_at: new Date('2026-06-12T10:00:00Z') });
  queryRows
    .mockResolvedValueOnce([
      { id: 'e1', event_ts: new Date('2026-06-12T09:00:00Z'), raw_value: 'KA01AB1234', detection_method: 'FASTag', direction: 'entry', access_decision: 'allow', resident_name: 'Mukesh' },
    ])
    .mockResolvedValueOnce([
      { id: 'd1', period: '2026-06', base_amount: 4000, penalty_amount: 500, due_date: '2026-06-30' },
    ]);
}

describe('GET /resident/home', () => {
  it('requires a resident token', async () => {
    expect((await request('GET', '/api/v1/resident/home')).status).toBe(401);
  });

  it('returns the aggregate home summary scoped to the unit', async () => {
    seedHappyPath();
    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.gateGlance).toEqual({
      visitors: { expected: 2 },
      parcels: { pending: 1 },
      helpers: { expected: 3, arrived: 1 },
    });
    expect(json.data.recentActivity).toHaveLength(1);
    expect(json.data.recentActivity[0].plate).toBe('KA01AB1234');
    expect(json.data.dues).toEqual({ outstanding: 4500, earliestDueDate: '2026-06-30', pendingCount: 1 });
    expect(json.data.community.pinnedNotice.title).toBe('Water cut 6pm');
    expect(json.data.community.upcomingEvent).toBeNull();
  });

  it('degrades a failed section to a default instead of 500', async () => {
    queryOne
      .mockResolvedValueOnce({ c: 2 })
      .mockResolvedValueOnce({ c: 1 })
      .mockResolvedValueOnce({ expected: 0, arrived: 0 })
      .mockResolvedValueOnce(null);
    queryRows
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('db down'));
    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.dues).toEqual({ outstanding: 0, earliestDueDate: null, pendingCount: 0 });
    expect(json.data.gateGlance.parcels.pending).toBe(1);
  });
});
