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
vi.mock('../mqtt.js', () => ({ publishGateCommand: vi.fn().mockResolvedValue({}), getMqttClient: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, query } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); query.mockReset(); });

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const admin = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'Admin' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('POST /gates/:id/command', () => {
  it('requires auth', async () => {
    const { status } = await request('POST', '/api/v1/gates/gate1/command', { body: { action: 'open' } });
    expect(status).toBe(401);
  });

  it('rejects a resident (not guard or admin)', async () => {
    const { status } = await request('POST', '/api/v1/gates/gate1/command', {
      headers: { Authorization: `Bearer ${resident}` }, body: { action: 'open' },
    });
    expect(status).toBe(403);
  });

  // The guard app's core "Open gate" / "Deny" action calls exactly this endpoint
  // (see apps/guard-app/src/api/client.ts: sendGateCommand) -- a guard MUST be
  // allowed to call it, or the entire app's primary function is unusable.
  it('lets a guard send a command', async () => {
    queryOne.mockResolvedValueOnce({ id: 'gate1', community_id: 'c1', name: 'Main Gate' });
    const { status, json } = await request('POST', '/api/v1/gates/gate1/command', {
      headers: { Authorization: `Bearer ${guard}` }, body: { action: 'open' },
    });
    expect(status).toBe(201);
    expect(json.data.action).toBe('open');
  });

  it('still lets an admin send a command', async () => {
    queryOne.mockResolvedValueOnce({ id: 'gate1', community_id: 'c1', name: 'Main Gate' });
    const { status } = await request('POST', '/api/v1/gates/gate1/command', {
      headers: { Authorization: `Bearer ${admin}` }, body: { action: 'close' },
    });
    expect(status).toBe(201);
  });
});
