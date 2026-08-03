import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { authenticateJWT, authenticateDevice, generateTestToken } from '../middleware/auth.js';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(true) } }));

function mockReqRes(headers = {}) {
  const req = { headers };
  const res = {
    locals: {},
    status(s) { this.statusCode = s; return this; },
    json(d) { this.body = d; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('authenticateJWT', () => {
  it('passes with valid token and correct role', () => {
    const token = generateTestToken({ sub: 'user-1', role: 'admin', community_id: 'c1' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    authenticateJWT(['admin'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.sub).toBe('user-1');
    expect(req.user.role).toBe('admin');
  });

  it('fails without Authorization header', () => {
    const { req, res, next } = mockReqRes({});
    authenticateJWT()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('fails with wrong role', () => {
    const token = generateTestToken({ sub: 'user-1', role: 'resident' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    authenticateJWT(['admin'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('passes with no role restriction', () => {
    const token = generateTestToken({ sub: 'user-1', role: 'resident' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    authenticateJWT()(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('POST /auth/guard-login (NAZ-002 — gate + society name for the header)', () => {
  let server, baseUrl;

  beforeAll(async () => {
    const { default: app } = await import('../index.js');
    await new Promise((resolve) => {
      server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
    });
    return () => server.close();
  });

  beforeEach(async () => {
    const { queryOne } = await import('../db/queries.js');
    queryOne.mockReset();
  });

  it('returns gateName and communityName alongside the existing user fields', async () => {
    const { queryOne } = await import('../db/queries.js');
    queryOne.mockResolvedValueOnce({
      id: 'guard-1',
      community_id: 'c1',
      unit_id: null,
      name: 'Ramesh',
      mobile: '9900000000',
      type: 'guard',
      password_hash: 'hashed',
      preferred_language: null,
      community_config: {},
      gate_id: 'gate-1',
      gate_name: 'Main Gate',
      community_name: 'Palm Meadows',
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/guard-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Ramesh', password: 'whatever' }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.user.gateName).toBe('Main Gate');
    expect(json.data.user.communityName).toBe('Palm Meadows');
    expect(json.data.user.name).toBe('Ramesh');
  });
});

describe('authenticateDevice', () => {
  it('passes with valid device token', () => {
    const token = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    const { req, res, next } = mockReqRes({ 'x-device-token': token });
    authenticateDevice(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.device.gate_id).toBe('gate-01');
  });

  it('fails without X-Device-Token', () => {
    const { req, res, next } = mockReqRes({});
    authenticateDevice(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('fails with invalid token', () => {
    const { req, res, next } = mockReqRes({ 'x-device-token': 'invalid-token' });
    authenticateDevice(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
