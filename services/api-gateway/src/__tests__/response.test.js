import { describe, it, expect } from 'vitest';
import { success, error } from '../middleware/response.js';

function mockRes() {
  const res = {
    locals: {},
    status(s) { this.statusCode = s; return this; },
    json(d) { this.body = d; return this; },
  };
  return res;
}

describe('response helpers', () => {
  it('success wraps data correctly', () => {
    const res = mockRes();
    success(res, { id: '123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('123');
    expect(res.body.meta.ts).toBeDefined();
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('error wraps message correctly', () => {
    const res = mockRes();
    error(res, 'Not found', 404);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Not found');
  });

  it('success with custom status code', () => {
    const res = mockRes();
    success(res, { id: '456' }, 201);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
