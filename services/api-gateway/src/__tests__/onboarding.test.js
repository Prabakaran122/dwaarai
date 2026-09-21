import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

// One client, captured, so a test can assert what ran inside the transaction
// and in which order.
const client = {
  query: vi.fn().mockResolvedValue({ rows: [{}], rowCount: 1 }),
  release: vi.fn(),
};
vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(async () => client),
    on: vi.fn(),
  },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => {
  queryOne.mockReset();
  client.query.mockReset();
  client.release.mockReset();
  client.query.mockResolvedValue({ rows: [{ id: 'new-community' }], rowCount: 1 });
});

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const superAdmin = generateTestToken({ sub: 'sa1', role: 'super_admin', community_id: null });
const communityAdmin = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });

const body = {
  property: { name: 'The Leela Palace', address: 'Old Airport Rd', contactName: 'Asha', contactPhone: '9876543210' },
  admin: { name: 'Asha R', username: 'leela.admin', password: 'correct-horse' },
  modules: ['valet'],
};

const sqlRun = () => client.query.mock.calls.map((c) => c[0]);

describe('POST /admin/onboarding/valet', () => {
  it('refuses a community_admin — onboarding is a commercial act', async () => {
    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${communityAdmin}` }, body,
    });
    expect(status).toBe(403);
  });

  it('creates the property, its modules and its login in one transaction', async () => {
    const { status, json } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });

    expect(status).toBe(201);
    const sql = sqlRun();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.some((s) => /INSERT INTO communities/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT INTO community_entitlements/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT INTO admins/.test(s))).toBe(true);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(json.data.communityId).toBe('new-community');
    expect(json.data.adminUsername).toBe('leela.admin');
  });

  it('stores the modules it was told to sell', async () => {
    await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });
    const call = client.query.mock.calls.find((c) => /community_entitlements/.test(c[0]));
    expect(call[1]).toContainEqual(['valet']);
  });

  it('never stores the password itself', async () => {
    await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });
    const call = client.query.mock.calls.find((c) => /INSERT INTO admins/.test(c[0]));
    expect(call[1]).not.toContain('correct-horse');
    expect(call[1].some((p) => typeof p === 'string' && p.startsWith('$2'))).toBe(true);
  });

  it('rolls back and leaves no half-made client when a step fails', async () => {
    client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO admins/.test(sql)) throw new Error('duplicate key');
      return { rows: [{ id: 'new-community' }], rowCount: 1 };
    });

    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });

    // A property that exists with no way to sign into it is worse than no
    // property: it looks onboarded on every list and cannot be used.
    expect(status).toBe(500);
    expect(sqlRun()).toContain('ROLLBACK');
    expect(sqlRun()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects a username already taken before opening a transaction', async () => {
    queryOne.mockResolvedValueOnce({ id: 'existing' });
    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });
    expect(status).toBe(409);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('defaults to valet-only, since that is what this flow is for', async () => {
    await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { property: body.property, admin: body.admin },
    });
    const call = client.query.mock.calls.find((c) => /community_entitlements/.test(c[0]));
    expect(call[1]).toContainEqual(['valet']);
  });

  it('rejects a password too short to be worth setting', async () => {
    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { ...body, admin: { ...body.admin, password: 'abc' } },
    });
    expect(status).toBe(400);
  });
});

describe('POST /admin/onboarding/valet — failures before the transaction', () => {
  it('answers 500 rather than hanging when the pool cannot be reached', async () => {
    const pool = (await import('../db/pool.js')).default;
    pool.connect.mockRejectedValueOnce(new Error('no connection'));

    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });

    // An unhandled rejection here leaves the caller waiting on a socket that
    // never answers, which is the one failure mode worse than an error.
    expect(status).toBe(500);
  });

  it('answers 500 rather than hanging when the username lookup fails', async () => {
    queryOne.mockRejectedValueOnce(new Error('db down'));
    const { status } = await request('POST', '/api/v1/admin/onboarding/valet', {
      headers: { Authorization: `Bearer ${superAdmin}` }, body,
    });
    expect(status).toBe(500);
  });
});

describe('DELETE /admin/communities/:id', () => {
  const empty = { residents: '0', units: '0', gates: '0', vehicles: '0', tickets: '0' };

  it('refuses a community_admin', async () => {
    const { status } = await request('DELETE', '/api/v1/admin/communities/c1', {
      headers: { Authorization: `Bearer ${communityAdmin}` },
    });
    expect(status).toBe(403);
  });

  it('404s for a community that is not there', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('DELETE', '/api/v1/admin/communities/nope', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });
    expect(status).toBe(404);
  });

  it('removes an empty property along with what only exists because of it', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c9', name: 'Onboarding Smoke Test' })
      .mockResolvedValueOnce(empty);

    const { status, json } = await request('DELETE', '/api/v1/admin/communities/c9', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });

    expect(status).toBe(200);
    const sql = sqlRun();
    expect(sql[0]).toBe('BEGIN');
    // The login and the entitlement row are not data the property accumulated;
    // they were made for it and are meaningless without it.
    expect(sql.some((s) => /DELETE FROM admins/.test(s))).toBe(true);
    expect(sql.some((s) => /DELETE FROM community_entitlements/.test(s))).toBe(true);
    expect(sql.some((s) => /DELETE FROM communities/.test(s))).toBe(true);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(json.data.deleted).toBe('Onboarding Smoke Test');
  });

  it('refuses a property that has real operational data, and says what', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c1', name: 'Palm Meadows' })
      .mockResolvedValueOnce({ residents: '25', units: '13', gates: '3', vehicles: '19', tickets: '0' });

    const { status, json } = await request('DELETE', '/api/v1/admin/communities/c1', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });

    // Deleting a live property is never what somebody meant by this button.
    // Naming the counts is the difference between "no" and "no, because".
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/25 residents/);
    expect(json.error.message).toMatch(/13 units/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('counts valet tickets too, so a valet-only property is protected', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c2', name: 'The Leela' })
      .mockResolvedValueOnce({ residents: '0', units: '0', gates: '0', vehicles: '0', tickets: '7' });

    const { status, json } = await request('DELETE', '/api/v1/admin/communities/c2', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });

    // A hotel has no residents or units at all -- counting only those would
    // make every valet property look empty and freely deletable.
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/7 valet tickets/);
  });

  it('rolls back if any part of the removal fails', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c9', name: 'Test' })
      .mockResolvedValueOnce(empty);
    client.query.mockImplementation(async (sql) => {
      if (/DELETE FROM communities/.test(sql)) throw new Error('fk violation');
      return { rows: [], rowCount: 1 };
    });

    const { status } = await request('DELETE', '/api/v1/admin/communities/c9', {
      headers: { Authorization: `Bearer ${superAdmin}` },
    });

    expect(status).toBe(500);
    expect(sqlRun()).toContain('ROLLBACK');
    expect(sqlRun()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
