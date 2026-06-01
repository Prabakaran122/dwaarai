import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() } }));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { broadcast } = await import('../websocket.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { query.mockReset(); queryOne.mockReset(); queryRows.mockReset(); broadcast.mockClear(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const admin = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'Admin' });

describe('Incident reporting', () => {
  it('POST /incidents requires a guard', async () => {
    expect((await request('POST', '/api/v1/incidents', { body: { type: 'tailgating' } })).status).toBe(401);
  });

  it('rejects a missing type', async () => {
    const { status } = await request('POST', '/api/v1/incidents', { headers: { Authorization: `Bearer ${guard}` }, body: {} });
    expect(status).toBe(400);
  });

  it('files an incident (accepting the app\'s gateId) and broadcasts', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1', type: 'suspicious_person', description: 'loitering', status: 'open', gate_id: 'gate1', reported_by_name: 'Ramesh', created_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/incidents', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { type: 'suspicious_person', description: 'loitering', gateId: 'gate1' },
    });
    expect(status).toBe(201);
    expect(json.data.type).toBe('suspicious_person');
    expect(json.data.status).toBe('open');
    expect(broadcast.mock.calls[0][1]).toBe('incident:reported');
  });

  it('GET /incidents requires admin', async () => {
    expect((await request('GET', '/api/v1/incidents', { headers: { Authorization: `Bearer ${guard}` } })).status).toBe(403);
  });

  it('GET /incidents lists for admin', async () => {
    queryRows.mockResolvedValueOnce([{ id: 'i1', type: 'tailgating', description: null, status: 'open', gate_id: 'gate1', reported_by_name: 'Ramesh', created_at: new Date() }]);
    const { status, json } = await request('GET', '/api/v1/incidents', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(200);
    expect(json.data[0].type).toBe('tailgating');
  });

  it('admin reviews an open incident', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1' });
    const { status, json } = await request('POST', '/api/v1/incidents/i1/review', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(200);
    expect(json.data.status).toBe('reviewed');
  });

  it('review returns 404 for unknown/already-reviewed', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/incidents/iX/review', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(404);
  });
});
