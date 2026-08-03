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
const { queryOne, query } = await import('../db/queries.js');
const { broadcast } = await import('../websocket.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); query.mockReset(); broadcast.mockReset(); });

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1' });
const communityAdmin = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });
const superAdmin = generateTestToken({ sub: 'sa1', role: 'super_admin', community_id: null });

describe('GET /entitlements', () => {
  it('requires auth', async () => {
    expect((await request('GET', '/api/v1/entitlements')).status).toBe(401);
  });

  it('returns the community row when one exists', async () => {
    queryOne.mockResolvedValueOnce({
      community_id: 'c1', fastag_enabled: true, anpr_enabled: true, face_enabled: false, ai_anomaly_enabled: false,
      updated_at: new Date('2026-08-01T00:00:00Z'),
    });
    const { status, json } = await request('GET', '/api/v1/entitlements', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data).toEqual({
      fastag: true, anpr: true, face: false, aiAnomaly: false,
      tier: 'Basic', updatedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('degrades to Starter defaults when no row exists yet', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('GET', '/api/v1/entitlements', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data).toEqual({ fastag: true, anpr: false, face: false, aiAnomaly: false, tier: 'Starter', updatedAt: null });
  });
});

describe('GET /entitlements/:communityId (super_admin only, NAZ-050..055 admin UI)', () => {
  it('rejects a guard token', async () => {
    const { status } = await request('GET', '/api/v1/entitlements/c1', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(403);
  });

  it('rejects a community_admin token', async () => {
    const { status } = await request('GET', '/api/v1/entitlements/c1', { headers: { Authorization: `Bearer ${communityAdmin}` } });
    expect(status).toBe(403);
  });

  it('lets super_admin fetch any community by id', async () => {
    queryOne.mockResolvedValueOnce({
      community_id: 'c2', fastag_enabled: true, anpr_enabled: true, face_enabled: true, ai_anomaly_enabled: false,
      updated_at: new Date('2026-08-01T00:00:00Z'),
    });
    const { status, json } = await request('GET', '/api/v1/entitlements/c2', { headers: { Authorization: `Bearer ${superAdmin}` } });
    expect(status).toBe(200);
    expect(json.data.tier).toBe('Pro');
    expect(queryOne).toHaveBeenCalledWith(expect.any(String), ['c2']);
  });

  it('degrades to Starter defaults when the community has no row yet', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('GET', '/api/v1/entitlements/c3', { headers: { Authorization: `Bearer ${superAdmin}` } });
    expect(status).toBe(200);
    expect(json.data).toEqual({ fastag: true, anpr: false, face: false, aiAnomaly: false, tier: 'Starter', updatedAt: null });
  });
});

describe('PUT /entitlements/:communityId', () => {
  it('rejects a guard token', async () => {
    const { status } = await request('PUT', '/api/v1/entitlements/c1', { headers: { Authorization: `Bearer ${guard}` }, body: {} });
    expect(status).toBe(403);
  });

  it('rejects a community_admin token (BRD: societies cannot self-toggle)', async () => {
    const { status } = await request('PUT', '/api/v1/entitlements/c1', { headers: { Authorization: `Bearer ${communityAdmin}` }, body: {} });
    expect(status).toBe(403);
  });

  it('lets super_admin upsert and broadcasts the change', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { status, json } = await request('PUT', '/api/v1/entitlements/c1', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { fastag: true, anpr: true, face: true, aiAnomaly: true },
    });
    expect(status).toBe(200);
    expect(json.data.tier).toBe('Elite');
    expect(broadcast.mock.calls[0]).toEqual(['c1', 'entitlement:updated', json.data]);
  });

  it('validates the body', async () => {
    const { status } = await request('PUT', '/api/v1/entitlements/c1', {
      headers: { Authorization: `Bearer ${superAdmin}` },
      body: { fastag: 'yes' },
    });
    expect(status).toBe(400);
  });
});
