import { describe, it, expect, vi } from 'vitest';
import { authenticateJWT, authenticateDevice, generateTestToken } from '../middleware/auth.js';

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
