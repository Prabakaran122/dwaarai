import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing routes
vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

// Mock otp module
vi.mock('../otp.js', () => ({
  generateOTP: vi.fn(() => '123456'),
  sendOTPViaSMS: vi.fn(async () => ({ success: true, mock: true })),
}));

import express from 'express';
import { query, queryOne, queryRows } from '../db.js';
import { generateOTP, sendOTPViaSMS } from '../otp.js';
import routes from '../routes.js';

// -- Test app helper ---------------------------------------------------------

function createApp(userOrDevice = {}) {
  const app = express();
  app.use(express.json());
  // Inject fake user/device context
  app.use((req, _res, next) => {
    if (userOrDevice.gate_id) {
      req.device = userOrDevice;
    } else {
      req.user = userOrDevice;
    }
    next();
  });
  app.use('/', routes);
  return app;
}

async function request(app, method, path, body = undefined) {
  const { default: http } = await import('http');
  const server = app.listen(0);
  const addr = server.address();
  const port = addr.port;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        server.close();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// -- Tests -------------------------------------------------------------------

const residentUser = {
  sub: 'user-1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
};

const adminUser = {
  sub: 'admin-1',
  role: 'admin',
  community_id: 'c1',
  unit_id: 'u1',
};

const device = {
  gate_id: 'g1',
  community_id: 'c1',
};

describe('POST /passes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pass with valid data and returns OTP', async () => {
    const mockPass = {
      id: 'p1',
      community_id: 'c1',
      unit_id: 'u1',
      created_by: 'user-1',
      visitor_name: 'Rajesh Kumar',
      visitor_mobile: '+919876543210',
      otp: '123456',
      valid_from: '2026-03-20T08:00:00.000Z',
      valid_until: '2026-03-20T18:00:00.000Z',
      max_uses: 1,
      uses_count: 0,
      status: 'active',
      sms_sent: false,
    };
    queryOne.mockResolvedValueOnce(mockPass); // INSERT
    query.mockResolvedValueOnce({}); // UPDATE sms_sent

    const app = createApp(residentUser);
    const res = await request(app, 'POST', '/passes', {
      visitor_name: 'Rajesh Kumar',
      visitor_mobile: '+919876543210',
      valid_from: '2026-03-20T08:00:00.000Z',
      valid_until: '2026-03-20T18:00:00.000Z',
      max_uses: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.otp).toBe('123456');
    expect(res.body.data.visitor_name).toBe('Rajesh Kumar');
    expect(generateOTP).toHaveBeenCalledWith(6);
    expect(sendOTPViaSMS).toHaveBeenCalledWith('+919876543210', '123456', 'Rajesh Kumar');
  });

  it('rejects missing required fields', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'POST', '/passes', {
      visitor_name: 'Test',
      // missing valid_from, valid_until
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Validation error');
  });

  it('rejects empty visitor_name', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'POST', '/passes', {
      visitor_name: '',
      valid_from: '2026-03-20T08:00:00.000Z',
      valid_until: '2026-03-20T18:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /passes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passes for resident (filtered by unit)', async () => {
    const now = new Date();
    queryRows.mockResolvedValueOnce([
      { id: 'p1', visitor_name: 'Rajesh', unit_id: 'u1', status: 'active', created_at: now },
    ]);

    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/passes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passes).toHaveLength(1);
    // Verify resident filter was applied (unit_id in query)
    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('unit_id');
    expect(params).toContain('u1');
  });

  it('returns passes for admin (all in community)', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/passes');

    expect(res.status).toBe(200);
    const [sql] = queryRows.mock.calls[0];
    expect(sql).not.toContain('unit_id');
  });
});

describe('DELETE /passes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revokes an active pass', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'p1',
      status: 'revoked',
      visitor_name: 'Rajesh Kumar',
    });

    const app = createApp(residentUser);
    const res = await request(app, 'DELETE', '/passes/p1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('revoked');
    // Verify the UPDATE query checks created_by and status
    const [sql, params] = queryOne.mock.calls[0];
    expect(sql).toContain("status = 'revoked'");
    expect(sql).toContain('created_by');
    expect(params).toContain('user-1');
    expect(params).toContain('p1');
  });

  it('returns 404 for non-existent or already revoked pass', async () => {
    queryOne.mockResolvedValueOnce(null);

    const app = createApp(residentUser);
    const res = await request(app, 'DELETE', '/passes/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /passes/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a valid OTP', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'p1',
      visitor_name: 'Rajesh Kumar',
      unit_id: 'u1',
      uses_count: 0,
      max_uses: 1,
      status: 'active',
    });
    query.mockResolvedValueOnce({}); // UPDATE uses_count

    const app = createApp(device);
    const res = await request(app, 'POST', '/passes/verify', {
      otp: '123456',
      gate_id: '00000000-0000-0000-0000-000000100001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('allow');
    expect(res.body.data.visitor_name).toBe('Rajesh Kumar');
    expect(res.body.data.uses_count).toBe(1);
    // Verify the pass was marked as 'used' since uses_count (1) >= max_uses (1)
    const [, updateParams] = query.mock.calls[0];
    expect(updateParams[0]).toBe(1); // new uses_count
    expect(updateParams[1]).toBe('used'); // new status
  });

  it('denies an expired pass (no matching row)', async () => {
    queryOne.mockResolvedValueOnce(null); // no valid pass found

    const app = createApp(device);
    const res = await request(app, 'POST', '/passes/verify', {
      otp: '999999',
      gate_id: '00000000-0000-0000-0000-000000100001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('deny');
    expect(res.body.data.reason).toBe('invalid_or_expired');
  });

  it('denies an already-used pass (no matching row)', async () => {
    queryOne.mockResolvedValueOnce(null); // uses_count >= max_uses means no match

    const app = createApp(device);
    const res = await request(app, 'POST', '/passes/verify', {
      otp: '123456',
      gate_id: '00000000-0000-0000-0000-000000100001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('deny');
    expect(res.body.data.reason).toBe('invalid_or_expired');
  });

  it('rejects invalid request body', async () => {
    const app = createApp(device);
    const res = await request(app, 'POST', '/passes/verify', {
      otp: '12', // too short
      gate_id: 'not-a-uuid',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /passes/assign-rfid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns RFID to a pass as admin', async () => {
    const rfidHash = 'a'.repeat(64);
    queryOne.mockResolvedValueOnce({
      id: 'p1',
      rfid_uid_hash: rfidHash,
      status: 'active',
    });

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/passes/assign-rfid', {
      pass_id: '00000000-0000-0000-0000-000000000001',
      rfid_uid_hash: rfidHash,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rfid_uid_hash).toBe(rfidHash);
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'POST', '/passes/assign-rfid', {
      pass_id: '00000000-0000-0000-0000-000000000001',
      rfid_uid_hash: 'a'.repeat(64),
    });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 for non-existent pass', async () => {
    queryOne.mockResolvedValueOnce(null);

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/passes/assign-rfid', {
      pass_id: '00000000-0000-0000-0000-000000000001',
      rfid_uid_hash: 'a'.repeat(64),
    });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
