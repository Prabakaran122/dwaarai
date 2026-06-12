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
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });
const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });

describe('Pets', () => {
  // -- Auth checks ------------------------------------------------------------

  it('GET /pets requires a resident token (401 no token)', async () => {
    const { status } = await request('GET', '/api/v1/pets');
    expect(status).toBe(401);
  });

  it('GET /pets rejects a guard token (403)', async () => {
    const { status } = await request('GET', '/api/v1/pets', {
      headers: { Authorization: `Bearer ${guard}` },
    });
    expect(status).toBe(403);
  });

  // -- GET /pets --------------------------------------------------------------

  it('GET /pets lists the unit\'s active pets with correct shape, scoped by unit_id and community_id', async () => {
    const now = new Date().toISOString();
    queryRows.mockResolvedValueOnce([
      { id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador', notes: 'Friendly', created_at: now },
      { id: 'p2', name: 'Whiskers', species: 'cat', breed: null, notes: null, created_at: now },
    ]);
    const { status, json } = await request('GET', '/api/v1/pets', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toEqual({ id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador', notes: 'Friendly', created_at: now });
    expect(json.data[1].breed).toBeNull();
    expect(json.data[1].notes).toBeNull();
    // Verify query was scoped: first param = unit_id, second = community_id
    expect(queryRows.mock.calls[0][1]).toEqual(['u1', 'c1']);
  });

  // -- POST /pets -------------------------------------------------------------

  it('POST /pets rejects an invalid species with 400', async () => {
    const { status, json } = await request('POST', '/api/v1/pets', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { name: 'Rex', species: 'snake' },
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('POST /pets creates a pet and returns 201 with the shaped row', async () => {
    const now = new Date().toISOString();
    queryOne.mockResolvedValueOnce({
      id: 'p3', name: 'Goldie', species: 'other', breed: null, notes: null, created_at: now,
    });
    const { status, json } = await request('POST', '/api/v1/pets', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { name: 'Goldie', species: 'other' },
    });
    expect(status).toBe(201);
    expect(json.data.name).toBe('Goldie');
    expect(json.data.species).toBe('other');
  });

  // -- PUT /pets/:id ----------------------------------------------------------

  it('PUT /pets/:id returns 404 when the pet is not in the caller\'s unit', async () => {
    queryOne.mockResolvedValueOnce(null); // ownership lookup → not found
    const { status, json } = await request('PUT', '/api/v1/pets/p-missing', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { name: 'Updated' },
    });
    expect(status).toBe(404);
    expect(json.error.message).toContain('not found');
  });

  it('PUT /pets/:id updates and returns the shaped row', async () => {
    const now = new Date().toISOString();
    queryOne
      .mockResolvedValueOnce({ id: 'p1' }) // ownership check
      .mockResolvedValueOnce({ id: 'p1', name: 'Bruno Jr', species: 'dog', breed: 'Labrador', notes: null, created_at: now }); // update result
    const { status, json } = await request('PUT', '/api/v1/pets/p1', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { name: 'Bruno Jr' },
    });
    expect(status).toBe(200);
    expect(json.data.name).toBe('Bruno Jr');
  });

  // -- DELETE /pets/:id -------------------------------------------------------

  it('DELETE /pets/:id soft-deletes the pet and returns { deleted: true }', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1' }) // ownership check
      .mockResolvedValueOnce({ id: 'p1' }); // update returning
    const { status, json } = await request('DELETE', '/api/v1/pets/p1', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(200);
    expect(json.data).toEqual({ deleted: true });
  });

  it('DELETE /pets/:id returns 404 when pet not found in caller\'s unit', async () => {
    queryOne.mockResolvedValueOnce(null); // ownership check → not found
    const { status } = await request('DELETE', '/api/v1/pets/p-missing', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(404);
  });
});
