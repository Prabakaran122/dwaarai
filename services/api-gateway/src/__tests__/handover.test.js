import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() } }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('Shift handover', () => {
  it('POST /handover requires a guard', async () => {
    const r1 = await request('POST', '/api/v1/handover', { body: { note: 'x' } });
    expect(r1.status).toBe(401);
    const r2 = await request('POST', '/api/v1/handover', { headers: { Authorization: `Bearer ${resident}` }, body: { note: 'x' } });
    expect(r2.status).toBe(403);
  });

  it('rejects an empty note', async () => {
    const { status } = await request('POST', '/api/v1/handover', { headers: { Authorization: `Bearer ${guard}` }, body: { note: '' } });
    expect(status).toBe(400);
  });

  it('records a handover note', async () => {
    queryOne.mockResolvedValueOnce({ id: 'h1', note: 'Gate 2 light is out', guard_name: 'Ramesh', created_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/handover', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { note: 'Gate 2 light is out' },
    });
    expect(status).toBe(201);
    expect(json.data.note).toBe('Gate 2 light is out');
  });

  it('GET /handover/latest returns the note + live open-item counts', async () => {
    queryOne
      .mockResolvedValueOnce({ note: 'Watch for plumber van', guard_name: 'Suresh', created_at: new Date() }) // latest
      .mockResolvedValueOnce({ n: 1 })  // sos active
      .mockResolvedValueOnce({ n: 3 }); // deliveries waiting
    const { status, json } = await request('GET', '/api/v1/handover/latest', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.handover.note).toBe('Watch for plumber van');
    expect(json.data.open_items.sos_active).toBe(1);
    expect(json.data.open_items.deliveries_waiting).toBe(3);
  });

  it('GET /handover/latest with no prior handover returns null + zero counts', async () => {
    queryOne
      .mockResolvedValueOnce(null)      // no latest
      .mockResolvedValueOnce({ n: 0 })
      .mockResolvedValueOnce({ n: 0 });
    const { status, json } = await request('GET', '/api/v1/handover/latest', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.handover).toBeNull();
    expect(json.data.open_items.sos_active).toBe(0);
  });
});
