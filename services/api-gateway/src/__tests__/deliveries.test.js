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
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { broadcast } = await import('../websocket.js');
const { sendNotification } = await import('../lib/fcm.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { query.mockReset(); queryOne.mockReset(); queryRows.mockReset(); broadcast.mockClear(); sendNotification.mockClear(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('Delivery management', () => {
  it('POST /deliveries requires a guard', async () => {
    const r1 = await request('POST', '/api/v1/deliveries', { body: { unit_number: 'A-1', company: 'Amazon' } });
    expect(r1.status).toBe(401);
    const r2 = await request('POST', '/api/v1/deliveries', { headers: { Authorization: `Bearer ${resident}` }, body: { unit_number: 'A-1', company: 'Amazon' } });
    expect(r2.status).toBe(403);
  });

  it('returns 404 when the unit is unknown', async () => {
    queryOne.mockResolvedValueOnce(null); // unit lookup
    const { status } = await request('POST', '/api/v1/deliveries', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'Z-9', company: 'Amazon' },
    });
    expect(status).toBe(404);
  });

  it('logs a delivery, pushes to residents, and broadcasts', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'u1' }) // unit
      .mockResolvedValueOnce({ id: 'd1', company: 'Amazon', note: null, status: 'waiting', unit_id: 'u1', logged_by_name: 'Ramesh', created_at: new Date() }); // insert
    queryRows.mockResolvedValueOnce([{ fcm_token: 'tok-1' }, { fcm_token: 'tok-2' }]); // residents
    const { status, json } = await request('POST', '/api/v1/deliveries', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-704', company: 'Amazon' },
    });
    expect(status).toBe(201);
    expect(json.data.company).toBe('Amazon');
    expect(json.data.notified).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0][1]).toBe('delivery:arrived');
  });

  it('GET /deliveries/active lists waiting deliveries', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'd1', company: 'Swiggy', note: null, status: 'waiting', unit_id: 'u1', unit_number: 'A-704', logged_by_name: 'Ramesh', created_at: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/deliveries/active', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data[0].unit_number).toBe('A-704');
  });

  it('rejects an invalid status', async () => {
    const { status } = await request('POST', '/api/v1/deliveries/d1/status', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { status: 'lost' },
    });
    expect(status).toBe(400);
  });

  it('updates status to left_at_gate and broadcasts', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1' }); // existing waiting
    const { status, json } = await request('POST', '/api/v1/deliveries/d1/status', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { status: 'left_at_gate' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('left_at_gate');
    expect(broadcast.mock.calls[0][1]).toBe('delivery:updated');
  });

  it('status update on unknown delivery returns 404', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/deliveries/dX/status', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { status: 'delivered' },
    });
    expect(status).toBe(404);
  });

  it('GET /deliveries (resident) requires a resident token', async () => {
    const r1 = await request('GET', '/api/v1/deliveries');
    expect(r1.status).toBe(401);
    const r2 = await request('GET', '/api/v1/deliveries', { headers: { Authorization: `Bearer ${guard}` } });
    expect(r2.status).toBe(403);
  });

  it('GET /deliveries lists the resident unit\'s parcels', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'd1', company: 'Amazon', note: 'Brown box', status: 'waiting', unit_id: 'u1', logged_by_name: 'Ramesh', created_at: new Date(), resolved_at: null },
    ]);
    const { status, json } = await request('GET', '/api/v1/deliveries', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].company).toBe('Amazon');
    expect(queryRows.mock.calls[0][1]).toEqual(['c1', 'u1']);
  });
});
