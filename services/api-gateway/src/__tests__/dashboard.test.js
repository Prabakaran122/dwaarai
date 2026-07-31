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

const admin = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1' });
const auth = { headers: { Authorization: `Bearer ${admin}` } };

// Promise.all evaluates its array left to right, so the mocks queue in the
// order the route issues them: queryOne → totals, vehicles, passes, sos,
// incidents; queryRows → hourly, daily, methods, gates.
function seed({ sosThrows = false } = {}) {
  queryOne
    .mockResolvedValueOnce({
      today_total: '128', today_deny: '4', today_review: '3',
      yest_total: '96', yest_deny: '9', yest_review: '1',
    })
    .mockResolvedValueOnce({ count: '412' })   // vehicles
    .mockResolvedValueOnce({ count: '17' });   // passes
  if (sosThrows) {
    queryOne.mockRejectedValueOnce(new Error('relation "sos_alerts" does not exist'));
  } else {
    queryOne.mockResolvedValueOnce({ count: '1' });
  }
  queryOne.mockResolvedValueOnce({ count: '2' }); // incidents

  queryRows
    .mockResolvedValueOnce([
      { bucket: new Date('2026-07-25T08:00:00Z'), allow: '12', deny: '1', review: '0' },
      { bucket: new Date('2026-07-25T09:00:00Z'), allow: '0', deny: '0', review: '0' },
    ])
    .mockResolvedValueOnce([
      { bucket: new Date('2026-07-24T00:00:00Z'), total: '96', deny: '9', review: '1' },
      { bucket: new Date('2026-07-25T00:00:00Z'), total: '128', deny: '4', review: '3' },
    ])
    .mockResolvedValueOnce([
      { method: 'anpr', count: '88' }, { method: 'fastag', count: '31' },
    ])
    .mockResolvedValueOnce([
      { id: 'g1', name: 'Main Gate', status: 'online', type: 'entry', last_seen: new Date('2026-07-25T09:00:00Z') },
      { id: 'g2', name: 'Rear Gate', status: 'offline', type: 'exit', last_seen: null },
    ]);
}

describe('GET /admin/dashboard/summary', () => {
  it('requires an admin token', async () => {
    expect((await request('GET', '/api/v1/admin/dashboard/summary')).status).toBe(401);
  });

  it('returns KPIs with a previous-period value for each delta', async () => {
    seed();
    const { status, json } = await request('GET', '/api/v1/admin/dashboard/summary', auth);
    expect(status).toBe(200);
    expect(json.data.kpis.todayEntries).toEqual({ value: 128, prev: 96 });
    expect(json.data.kpis.deniedToday).toEqual({ value: 4, prev: 9 });
    expect(json.data.kpis.reviewToday).toEqual({ value: 3, prev: 1 });
    expect(json.data.kpis.totalVehicles).toEqual({ value: 412 });
    expect(json.data.kpis.activePasses).toEqual({ value: 17 });
  });

  it('derives gate health from the gate rows rather than a separate count', async () => {
    seed();
    const { json } = await request('GET', '/api/v1/admin/dashboard/summary', auth);
    expect(json.data.kpis.gatesOnline).toEqual({ value: 1, total: 2 });
    expect(json.data.attention.gatesOffline).toBe(1);
    expect(json.data.gates).toHaveLength(2);
    expect(json.data.gates[0]).toMatchObject({ id: 'g1', name: 'Main Gate', status: 'online' });
  });

  it('returns numbers, not the strings postgres COUNT gives back', async () => {
    seed();
    const { json } = await request('GET', '/api/v1/admin/dashboard/summary', auth);
    for (const row of json.data.hourly) {
      expect(typeof row.allow).toBe('number');
      expect(typeof row.deny).toBe('number');
    }
    expect(json.data.methods[0]).toEqual({ method: 'anpr', count: 88 });
    // A quiet hour must survive as a real zero — the chart needs the gap.
    expect(json.data.hourly[1]).toMatchObject({ allow: 0, deny: 0, review: 0 });
  });

  it('rolls up everything needing attention', async () => {
    seed();
    const { json } = await request('GET', '/api/v1/admin/dashboard/summary', auth);
    expect(json.data.attention).toEqual({
      gatesOffline: 1, pendingReviews: 3, activeSos: 1, openIncidents: 2,
    });
  });

  it('still answers when sos_alerts has not been migrated yet', async () => {
    seed({ sosThrows: true });
    const { status, json } = await request('GET', '/api/v1/admin/dashboard/summary', auth);
    expect(status).toBe(200);
    expect(json.data.attention.activeSos).toBe(0);      // degraded, not a 500
    expect(json.data.attention.openIncidents).toBe(2);  // the rest still works
  });

  it('buckets in the community time zone, not UTC', async () => {
    seed();
    await request('GET', '/api/v1/admin/dashboard/summary', auth);
    // Every windowed query must carry the zone — bucketing on UTC would roll
    // the day over at 05:30 IST and misfile an evening's traffic.
    const zones = [...queryOne.mock.calls, ...queryRows.mock.calls]
      .filter(([sql]) => sql.includes('AT TIME ZONE'))
      .map(([, params]) => params[1]);
    expect(zones.length).toBeGreaterThan(0);
    expect(new Set(zones)).toEqual(new Set(['Asia/Kolkata']));
  });

  it('accepts a time zone override', async () => {
    seed();
    const { json } = await request('GET', '/api/v1/admin/dashboard/summary?tz=UTC', auth);
    expect(json.data.tz).toBe('UTC');
    const zones = queryRows.mock.calls.filter(([sql]) => sql.includes('AT TIME ZONE')).map(([, p]) => p[1]);
    expect(new Set(zones)).toEqual(new Set(['UTC']));
  });
});
