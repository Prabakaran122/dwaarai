import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { validCommitteeRole } from '../routes/residents-admin.js';

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
beforeEach(() => {
  queryRows.mockReset();
  queryOne.mockReset();
});

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const admin = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });
const superAdminNoCommunity = generateTestToken({ sub: 'sa1', role: 'super_admin', community_id: null });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1' });

describe('validCommitteeRole', () => {
  it('accepts the four roles and null (meaning: remove from committee)', () => {
    for (const r of ['president', 'secretary', 'treasurer', 'member']) {
      expect(validCommitteeRole(r)).toBe(true);
    }
    expect(validCommitteeRole(null)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(validCommitteeRole('admin')).toBe(false);
    expect(validCommitteeRole('')).toBe(false);
    expect(validCommitteeRole('SECRETARY')).toBe(false);
  });
});

describe('GET /admin/residents', () => {
  it('requires an admin token', async () => {
    expect((await request('GET', '/api/v1/admin/residents')).status).toBe(401);
    expect((await request('GET', '/api/v1/admin/residents', { headers: { Authorization: `Bearer ${resident}` } })).status).toBe(403);
  });

  it('returns 400 when no community is selected (super_admin with no X-Community-Id)', async () => {
    const { status, json } = await request('GET', '/api/v1/admin/residents', { headers: { Authorization: `Bearer ${superAdminNoCommunity}` } });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/no community selected/i);
  });

  it('resolves community from the X-Community-Id header for a super_admin', async () => {
    queryRows.mockResolvedValueOnce([{ id: 'r1', name: 'Asha', type: 'owner', committee_role: null, unit: 'A-101' }]);
    const { status } = await request('GET', '/api/v1/admin/residents', {
      headers: { Authorization: `Bearer ${superAdminNoCommunity}`, 'X-Community-Id': 'c2' },
    });
    expect(status).toBe(200);
    expect(queryRows.mock.calls[0][1][0]).toBe('c2');
  });

  it('scopes the query to the admin community and excludes guards', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/admin/residents', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(200);
    const [sql, params] = queryRows.mock.calls[0];
    expect(params[0]).toBe('c1');
    expect(sql).toMatch(/r\.type NOT IN/);
    expect(params).toContain('guard');
  });

  it('escapes % and _ in the search term so they cannot act as wildcards', async () => {
    queryRows.mockResolvedValueOnce([]);
    await request('GET', '/api/v1/admin/residents?search=50%25_off', { headers: { Authorization: `Bearer ${admin}` } });
    const [, params] = queryRows.mock.calls[0];
    const searchParam = params[params.length - 1];
    expect(searchParam).toBe('%50\\%\\_off%');
  });
});

describe('PUT /admin/residents/:id/committee-role', () => {
  it('requires an admin token', async () => {
    expect((await request('PUT', '/api/v1/admin/residents/r1/committee-role', { body: { committee_role: 'secretary' } })).status).toBe(401);
  });

  it('rejects an invalid role before touching the database', async () => {
    const { status, json } = await request('PUT', '/api/v1/admin/residents/r1/committee-role', {
      headers: { Authorization: `Bearer ${admin}` },
      body: { committee_role: 'president-general' },
    });
    expect(status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
    expect(json.error).toBeTruthy();
  });

  it('sets committee_role and keeps is_committee in sync', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Asha', committee_role: 'secretary' });
    const { status, json } = await request('PUT', '/api/v1/admin/residents/r1/committee-role', {
      headers: { Authorization: `Bearer ${admin}` },
      body: { committee_role: 'secretary' },
    });
    expect(status).toBe(200);
    expect(json.data.committee_role).toBe('secretary');
    const [sql, params] = queryOne.mock.calls[0];
    expect(sql).toMatch(/is_committee = \(\$1 IS NOT NULL\)/);
    expect(params).toEqual(['secretary', 'r1', 'c1']);
  });

  it('clears both committee_role and is_committee when passed null', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Asha', committee_role: null });
    const { status } = await request('PUT', '/api/v1/admin/residents/r1/committee-role', {
      headers: { Authorization: `Bearer ${admin}` },
      body: { committee_role: null },
    });
    expect(status).toBe(200);
    const [, params] = queryOne.mock.calls[0];
    expect(params).toEqual([null, 'r1', 'c1']);
  });

  it('does not update a resident in another community (404)', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('PUT', '/api/v1/admin/residents/other-community-resident/committee-role', {
      headers: { Authorization: `Bearer ${admin}` },
      body: { committee_role: 'member' },
    });
    expect(status).toBe(404);
    const [, params] = queryOne.mock.calls[0];
    expect(params).toEqual(['member', 'other-community-resident', 'c1']);
  });
});
