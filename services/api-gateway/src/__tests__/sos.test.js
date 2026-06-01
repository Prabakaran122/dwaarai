import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

vi.mock('../../src/websocket.js', () => ({
  broadcast: vi.fn(),
  initWebSocket: vi.fn(),
  getIO: vi.fn(),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { broadcast } = await import('../websocket.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => { query.mockReset(); queryOne.mockReset(); queryRows.mockReset(); broadcast.mockClear(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const admin = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'Admin' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('SOS alerts', () => {
  it('POST /sos requires a guard', async () => {
    const r1 = await request('POST', '/api/v1/sos', { body: { type: 'fire' } });
    expect(r1.status).toBe(401);
    const r2 = await request('POST', '/api/v1/sos', { headers: { Authorization: `Bearer ${resident}` }, body: { type: 'fire' } });
    expect(r2.status).toBe(403);
  });

  it('rejects an invalid SOS type', async () => {
    const { status, json } = await request('POST', '/api/v1/sos', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { type: 'earthquake' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toContain('medical, fire, security, other');
  });

  it('raises an alert and broadcasts it', async () => {
    queryOne.mockResolvedValueOnce({
      id: 's1', community_id: 'c1', gate_id: 'gate1', raised_by: 'g1', raised_by_name: 'Ramesh',
      type: 'security', note: 'gate breach', status: 'active', created_at: new Date(),
    });
    const { status, json } = await request('POST', '/api/v1/sos', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { type: 'security', note: 'gate breach' },
    });
    expect(status).toBe(201);
    expect(json.data.type).toBe('security');
    expect(json.data.status).toBe('active');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toBe('c1');
    expect(broadcast.mock.calls[0][1]).toBe('sos:alert');
  });

  it('GET /sos/active lists active alerts (guard or admin)', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 's1', type: 'medical', note: null, status: 'active', gate_id: 'gate1', raised_by_name: 'Ramesh', created_at: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/sos/active', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].type).toBe('medical');
  });

  it('resolve marks the alert resolved and broadcasts', async () => {
    queryOne.mockResolvedValueOnce({ id: 's1', community_id: 'c1', status: 'active' });
    const { status, json } = await request('POST', '/api/v1/sos/s1/resolve', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.status).toBe('resolved');
    expect(broadcast.mock.calls[0][1]).toBe('sos:resolved');
  });

  it('resolve returns 404 for an unknown/already-resolved alert', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/sos/sX/resolve', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(404);
  });
});
