import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));

// Mock the db module
vi.mock('../db.js', () => {
  const pool = { query: mockQuery };
  return {
    default: pool,
    query: mockQuery,
    queryOne: mockQueryOne,
    queryRows: vi.fn(),
  };
});

import express from 'express';
import routes from '../routes.js';
import { sendPushNotification } from '../fcm.js';
import { sendSMS, sendEntryNotification, sendOTP } from '../sms.js';

// -- Test app helper ---------------------------------------------------------

function createApp() {
  const app = express();
  app.use(express.json());
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

describe('FCM mock mode', () => {
  it('logs instead of sending and returns mock result', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendPushNotification('test-token-abcdef1234567890', 'Test Title', 'Test Body');

    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(result.messageId).toMatch(/^mock-/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[FCM MOCK]'));

    spy.mockRestore();
  });
});

describe('SMS mock mode', () => {
  it('logs instead of sending and returns mock result', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendSMS('+919876543210', 'Hello test');

    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[SMS MOCK]'));

    spy.mockRestore();
  });

  it('sendEntryNotification formats message correctly', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendEntryNotification('+919876543210', 'John Doe', 'A-101');

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('John Doe'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('A-101'));

    spy.mockRestore();
  });

  it('sendOTP formats message correctly', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendOTP('+919876543210', '123456');

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('24 hours'));

    spy.mockRestore();
  });
});

describe('POST /notify/push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success when resident has FCM token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ fcm_token: 'token-abcdef1234567890xxxx' }],
    });

    const app = createApp();
    const res = await request(app, 'POST', '/notify/push', {
      resident_id: '00000000-0000-0000-0000-000000000001',
      title: 'Test',
      body: 'Test body',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.mock).toBe(true);
  });

  it('returns failure when resident has no FCM token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app, 'POST', '/notify/push', {
      resident_id: '00000000-0000-0000-0000-000000000001',
      title: 'Test',
      body: 'Test body',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(false);
    expect(res.body.data.reason).toBe('no_fcm_token');
  });

  it('rejects missing fields', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/push', {
      resident_id: 'r1',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /notify/sms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends SMS and returns success', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/sms', {
      mobile: '+919876543210',
      message: 'Test SMS message',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.mock).toBe(true);
  });

  it('rejects missing fields', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/sms', {
      mobile: '+919876543210',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /notify/entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends both push and SMS for entry notification', async () => {
    mockQueryOne.mockResolvedValueOnce({
      mobile: '+919876543210',
      fcm_token: 'token-abcdef1234567890xxxx',
    });

    const app = createApp();
    const res = await request(app, 'POST', '/notify/entry', {
      resident_id: '00000000-0000-0000-0000-000000000001',
      visitor_name: 'Jane Smith',
      unit_number: 'B-202',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.push).toBeDefined();
    expect(res.body.data.push.success).toBe(true);
    expect(res.body.data.sms).toBeDefined();
    expect(res.body.data.sms.success).toBe(true);
  });

  it('returns 404 when resident not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await request(app, 'POST', '/notify/entry', {
      resident_id: 'nonexistent',
      visitor_name: 'Jane Smith',
      unit_number: 'B-202',
    });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('rejects missing fields', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/entry', {
      resident_id: 'r1',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /notify/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a 6-digit OTP and sends SMS', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/otp', {
      mobile: '+919876543210',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.otp).toMatch(/^\d{6}$/);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.mock).toBe(true);
  });

  it('rejects missing mobile', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/notify/otp', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
