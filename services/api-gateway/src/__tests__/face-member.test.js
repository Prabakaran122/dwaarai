import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn(), connect: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn(), sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn(),
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryOne.mockResolvedValue(null); });

const owner = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('member face enrolment is scoped to the caller\'s own unit', () => {
  it('refuses a member who belongs to another unit', async () => {
    queryOne.mockResolvedValueOnce(null); // same-unit lookup finds nothing
    const { status } = await call('POST', '/api/v1/members/r9/face/enroll', { consent_acknowledged: true });
    expect(status).toBe(404);
  });

  it('enrols a member of the same unit', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', community_id: 'c1', name: 'Ravi' })
      .mockResolvedValueOnce({ status: 'pending', enrolled_at: '2026-08-05T00:00:00Z', activated_at: null });
    const { status } = await call('POST', '/api/v1/members/r2/face/enroll', { consent_acknowledged: true });
    expect(status).toBe(201);
  });

  // A client-supplied vector is an arbitrary value that would then match a real
  // face at the gate — accepting one lets any resident mint a gate credential
  // for anyone. The server derives it, exactly as self-enrolment does.
  it('refuses a caller-supplied vector', async () => {
    const { status } = await call('POST', '/api/v1/members/r2/face/enroll', {
      consent_acknowledged: true, vector: [0.42, 0.43],
    });
    expect(status).toBe(400);
    // Rejected before any lookup — the guard, not schema validation, did this.
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('never accepts an image', async () => {
    const { status, json } = await call('POST', '/api/v1/members/r2/face/enroll', {
      consent_acknowledged: true, image: 'data:image/jpeg;base64,AAAA',
    });
    expect(status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toMatch(/base64|data:image/);
  });

  it('requires consent before enrolling anyone', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', community_id: 'c1', name: 'Ravi' });
    const { status } = await call('POST', '/api/v1/members/r2/face/enroll', { consent_acknowledged: false });
    expect(status).toBe(400);
  });

  it('reads a member\'s enrolment status', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' })
      .mockResolvedValueOnce({ status: 'active', enrolled_at: '2026-08-01T00:00:00Z' });
    const { status, json } = await call('GET', '/api/v1/members/r2/face');
    expect(status).toBe(200);
    expect(json.data.status).toBe('active');
  });

  it('withdraws a member\'s enrolment', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' })
      .mockResolvedValueOnce({ id: 'f1' });
    const { status } = await call('DELETE', '/api/v1/members/r2/face');
    expect(status).toBe(200);
  });
});
