import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock the database before importing routes.
vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryRows, queryOne } = await import('../db/queries.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return () => server.close();
});

beforeEach(() => {
  queryRows.mockReset();
  queryOne.mockReset();
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const residentToken = generateTestToken({
  sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'unit1', name: 'Primary',
});

describe('Household members', () => {
  it('GET /members without auth returns 401', async () => {
    const { status } = await request('GET', '/api/v1/members');
    expect(status).toBe(401);
  });

  it('GET /members rejects non-resident role', async () => {
    const adminToken = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1' });
    const { status } = await request('GET', '/api/v1/members', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(403);
  });

  it('GET /members returns roster with is_self flag', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'r1', name: 'Primary', mobile: '9876500000', relationship: null, type: 'owner', is_primary: true, notify_on_approval: true, created_at: new Date() },
      { id: 'r2', name: 'Spouse', mobile: '9876511111', relationship: 'spouse', type: 'owner', is_primary: false, notify_on_approval: true, created_at: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/members', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].is_self).toBe(true);
    expect(json.data[1].is_self).toBe(false);
  });

  it('POST /members rejects an invalid mobile', async () => {
    const { status, json } = await request('POST', '/api/v1/members', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { name: 'Kid', mobile: '12345', relationship: 'child' },
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('POST /members rejects a number already in the household', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r2', unit_id: 'unit1' }); // existing in same unit
    const { status, json } = await request('POST', '/api/v1/members', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { name: 'Dup', mobile: '9876511111' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toContain('your household');
  });

  it('POST /members rejects a number registered to another unit', async () => {
    queryOne.mockResolvedValueOnce({ id: 'rX', unit_id: 'unit-other' });
    const { status, json } = await request('POST', '/api/v1/members', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { name: 'Elsewhere', mobile: '9876522222' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toContain('another unit');
  });

  it('POST /members creates a member (normalizing +91) and inherits type', async () => {
    queryOne
      .mockResolvedValueOnce(null) // no duplicate
      .mockResolvedValueOnce({ type: 'tenant' }) // inviter type
      .mockResolvedValueOnce({ id: 'r3', name: 'Driver', mobile: '9876533333', relationship: 'other', type: 'tenant', is_primary: false, notify_on_approval: true, created_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/members', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { name: 'Driver', mobile: '+91 98765 33333', relationship: 'other' },
    });
    expect(status).toBe(201);
    expect(json.data.type).toBe('tenant');
    expect(json.data.is_primary).toBe(false);
  });

  it('DELETE /members/:id refuses to remove the primary resident', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', is_primary: true });
    const { status, json } = await request('DELETE', '/api/v1/members/r1', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(403);
    expect(json.error.message).toContain('primary');
  });

  it('DELETE /members/:id soft-removes a non-primary member', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r2', is_primary: false });
    const { status, json } = await request('DELETE', '/api/v1/members/r2', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(200);
    expect(json.data.removed).toBe(true);
  });

  it('DELETE /members/:id returns 404 for a member outside the unit', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('DELETE', '/api/v1/members/rZ', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(404);
  });
});
