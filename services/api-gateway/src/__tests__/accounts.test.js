import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Real UUIDs: these columns are UUID, so a short string is refused by the
// schema before it reaches anything worth testing.
const ACC = '11111111-1111-1111-1111-111111111111';
const COM = '22222222-2222-2222-2222-222222222222';

const superAdmin = generateTestToken({ sub: 'sa', role: 'super_admin', community_id: null });
const communityAdmin = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });

describe('hotel groups', () => {
  it('lets ops create an account', async () => {
    queryOne.mockResolvedValueOnce({ id: ACC, name: 'The Leela Group' });

    const { status, json } = await request('POST', '/api/v1/admin/accounts', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { name: 'The Leela Group' },
    });

    expect(status).toBe(201);
    expect(json.data.account.name).toBe('The Leela Group');
  });

  it('refuses a property admin -- an account spans properties they do not hold', async () => {
    const { status } = await request('POST', '/api/v1/admin/accounts', {
      headers: { Authorization: `Bearer ${communityAdmin}` },
      body: { name: 'Sneaky Group' },
    });
    expect(status).toBe(403);
  });

  it('lists accounts with how many properties each holds', async () => {
    queryRows.mockResolvedValueOnce([{ id: ACC, name: 'The Leela Group', property_count: '4' }]);

    const { status, json } = await request('GET', '/api/v1/admin/accounts', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });

    expect(status).toBe(200);
    expect(json.data.accounts[0].propertyCount).toBe(4);
  });

  it('puts a property into an account', async () => {
    queryOne
      .mockResolvedValueOnce({ id: ACC })                       // account exists
      .mockResolvedValueOnce({ id: COM, account_id: ACC });    // updated

    const { status, json } = await request('PUT', `/api/v1/admin/communities/${COM}/account`, {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { accountId: ACC },
    });

    expect(status).toBe(200);
    expect(json.data.community.account_id).toBe(ACC);
  });

  it('takes a property back out of an account', async () => {
    queryOne.mockResolvedValueOnce({ id: COM, account_id: null });

    const { status, json } = await request('PUT', `/api/v1/admin/communities/${COM}/account`, {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { accountId: null },
    });

    // A group that loses its last property should not strand the property.
    expect(status).toBe(200);
    expect(json.data.community.account_id).toBeNull();
  });

  it('refuses to file a property under an account that does not exist', async () => {
    queryOne.mockResolvedValueOnce(null);

    const { status } = await request('PUT', `/api/v1/admin/communities/${COM}/account`, {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { accountId: '33333333-3333-3333-3333-333333333333' },
    });

    expect(status).toBe(404);
  });
});

describe('a client admin', () => {
  it('can be created against an account', async () => {
    queryOne
      .mockResolvedValueOnce(null)                 // username free
      .mockResolvedValueOnce({ id: ACC })       // account exists
      .mockResolvedValueOnce({ id: 'ad1', username: 'leela.group', role: 'client_admin' });

    const { status, json } = await request('POST', '/api/v1/admin/community-admins', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: {
        name: 'Group Admin', username: 'leela.group', password: 'a-real-password',
        role: 'client_admin', account_id: ACC,
      },
    });

    expect(status).toBe(201);
    expect(json.data.admin.role).toBe('client_admin');
  });

  it('needs an account, not a community', async () => {
    queryOne.mockResolvedValueOnce(null);

    const { status } = await request('POST', '/api/v1/admin/community-admins', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: {
        name: 'Group Admin', username: 'leela.group', password: 'a-real-password',
        role: 'client_admin', community_id: COM,
      },
    });

    // Scoping a group admin to one property would silently make them a
    // location manager with a misleading title.
    expect(status).toBe(400);
  });
});

describe('the token a client admin signs in with', () => {
  it('carries the account, or they can see none of their properties', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    queryOne.mockResolvedValueOnce({
      id: 'ad1', name: 'Group Admin', username: 'leela.group',
      password_hash: bcrypt.hashSync('a-real-password', 4),
      role: 'client_admin', community_id: null, account_id: ACC,
    });

    const { status, json } = await request('POST', '/api/v1/auth/admin-login', {
      body: { username: 'leela.group', password: 'a-real-password' },
    });

    expect(status).toBe(200);
    // valet-service reads req.user.account_id to scope the Locations list.
    // Without it in the token the claim is absent and every group admin is
    // told their account holds a single property.
    const claims = JSON.parse(
      Buffer.from(json.data.token.split('.')[1], 'base64').toString()
    );
    expect(claims.account_id).toBe(ACC);
    expect(claims.role).toBe('client_admin');
  });
});
