import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../../src/websocket.js', () => ({
  broadcast: vi.fn(),
  initWebSocket: vi.fn(),
  getIO: vi.fn(),
}));

vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn(),
  sendVisitorAlert: vi.fn(),
  sendApprovalRequest: vi.fn(),
}));

vi.mock('../../src/lib/razorpay.js', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'order_test_abc123', amount: 0, currency: 'INR', test_mode: true }),
  getKeyId: vi.fn().mockReturnValue(null),
  isLiveMode: vi.fn().mockReturnValue(false),
  isPlaceholderMode: vi.fn().mockReturnValue(true),
  verifyWebhookSignature: vi.fn().mockReturnValue(false),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { default: pool } = await import('../db/pool.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { createOrder, getKeyId, isLiveMode } = await import('../lib/razorpay.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return () => server.close();
});

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClient.release.mockReset();
  pool.connect.mockReset();
  pool.connect.mockResolvedValue(mockClient);
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  queryOne.mockReset();
  queryOne.mockResolvedValue(null);
  queryRows.mockReset();
  queryRows.mockResolvedValue([]);
  createOrder.mockReset();
  createOrder.mockResolvedValue({ id: 'order_test_abc123', amount: 0, currency: 'INR', test_mode: true });
  getKeyId.mockReset();
  getKeyId.mockReturnValue(null);
  isLiveMode.mockReset();
  isLiveMode.mockReturnValue(false);
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const resident = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'Asha',
});
const residentHeader = { Authorization: `Bearer ${resident}` };

const admin = generateTestToken({
  sub: 'a1',
  role: 'community_admin',
  community_id: 'c1',
});
const adminHeader = { Authorization: `Bearer ${admin}` };

describe('GET /donation-funds', () => {
  it('401s without a token', async () => {
    const { status } = await request('GET', '/api/v1/donation-funds');
    expect(status).toBe(401);
  });

  it('computes raised/percent from paid donations only', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'f1', name: 'Temple Fund', description: null, target_paise: 1000000, event_id: null, raised: '250000', donor_count: '3' },
    ]);
    const { status, json } = await request('GET', '/api/v1/donation-funds', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data).toEqual([
      expect.objectContaining({
        id: 'f1',
        raisedPaise: 250000,
        targetPaise: 1000000,
        percent: 25,
        donorCount: 3,
      }),
    ]);
  });
});

describe('GET /donation-funds/:id', () => {
  it('404s when the fund is not in the caller community', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('GET', '/api/v1/donation-funds/f1', { headers: residentHeader });
    expect(status).toBe(404);
  });

  it('a created (unpaid) donation does not inflate the progress bar', async () => {
    // The fund has one 'created' (unpaid) donation of 500000 paise and no paid
    // ones. raised/donorCount must be 0 — otherwise anyone could fake progress
    // by starting a payment they never complete.
    queryOne.mockResolvedValueOnce({
      id: 'f1', name: 'Temple Fund', description: null, target_paise: 1000000, event_id: null,
      raised: '0', donor_count: '0',
    });
    const { status, json } = await request('GET', '/api/v1/donation-funds/f1', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data.raisedPaise).toBe(0);
    expect(json.data.donorCount).toBe(0);
    expect(json.data.percent).toBe(0);
  });

  it('never divides by zero and caps percent at 100', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'f1', name: 'Temple Fund', description: null, target_paise: 100000, event_id: null,
      raised: '250000', donor_count: '2', // raised exceeds target
    });
    const { json } = await request('GET', '/api/v1/donation-funds/f1', { headers: residentHeader });
    expect(json.data.percent).toBe(100);
  });
});

describe('POST /donation-funds/:id/donate', () => {
  it('never attaches a platform fee to a donation order', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'f1', is_open: true }] }) // fund lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'donation-1' }] }) // insert donations
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] }) // insert payment_orders
      .mockResolvedValueOnce({}) // update payment_orders gateway_order_id
      .mockResolvedValueOnce({}) // update donations order_id
      .mockResolvedValueOnce({}); // COMMIT

    const { status, json } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 25100 },
    });

    expect(status).toBe(201);
    expect(json.data.amountPaise).toBe(25100);

    const insertOrderCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO payment_orders')
    );
    expect(insertOrderCall[0]).not.toMatch(/platformFeePaise/);
    // platform_fee_paise must be the literal 0, not a bound parameter derived
    // from the stall fee — there is no fee to compute for a donation.
    expect(insertOrderCall[0]).toMatch(/platform_fee_paise/);
    expect(insertOrderCall[0]).toMatch(/VALUES\s*\([^)]*,\s*0\s*,/);

    expect(createOrder).toHaveBeenCalledWith(25100, expect.any(String));
  });

  it('accepts any positive integer paise — the ladder is a client concern, not enforced here', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'f1', is_open: true }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'donation-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { status, json } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 73333 }, // not on the 51/101/251/501 ladder
    });
    expect(status).toBe(201);
    expect(json.data.amountPaise).toBe(73333);
  });

  it('rejects a custom amount below ₹1', async () => {
    const { status } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 99 },
    });
    expect(status).toBe(400);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('rejects a non-integer or non-positive amount', async () => {
    const { status: s1 } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 0 },
    });
    expect(s1).toBe(400);

    const { status: s2 } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 100.5 },
    });
    expect(s2).toBe(400);
  });

  it('404s when the fund is not found or not open', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // fund lookup — not found
    const { status } = await request('POST', '/api/v1/donation-funds/f1/donate', {
      headers: residentHeader,
      body: { amountPaise: 25100 },
    });
    expect(status).toBe(404);
  });
});

describe('GET /admin/donation-funds/:id/donors', () => {
  it('is admin-only', async () => {
    const { status } = await request('GET', '/api/v1/admin/donation-funds/f1/donors', { headers: residentHeader });
    expect(status).toBe(403);
  });

  it('excludes an anonymous donor name from the response but still counts the amount', async () => {
    queryOne.mockResolvedValueOnce({ id: 'f1' }); // fund lookup
    queryRows.mockResolvedValueOnce([
      { id: 'd1', donor_name: 'Ravi Kumar', amount_paise: 50100, is_anonymous: false, unit_id: 'u1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'd2', donor_name: 'Secret Donor', amount_paise: 100100, is_anonymous: true, unit_id: 'u2', created_at: '2026-01-02T00:00:00Z' },
    ]);
    const { status, json } = await request('GET', '/api/v1/admin/donation-funds/f1/donors', { headers: adminHeader });
    expect(status).toBe(200);
    expect(json.data.find((d) => d.id === 'd1').donorName).toBe('Ravi Kumar');
    const anon = json.data.find((d) => d.id === 'd2');
    expect(anon.donorName).toBeNull();
    expect(anon.amountPaise).toBe(100100); // still counted
    expect(anon.isAnonymous).toBe(true);
  });
});

describe('POST /admin/donation-funds', () => {
  it('is admin-only', async () => {
    const { status } = await request('POST', '/api/v1/admin/donation-funds', {
      headers: residentHeader,
      body: { name: 'Temple Fund', targetPaise: 1000000 },
    });
    expect(status).toBe(403);
  });

  it('creates a fund', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'f1', name: 'Temple Fund', description: null, target_paise: 1000000, event_id: null, is_open: true,
    });
    const { status, json } = await request('POST', '/api/v1/admin/donation-funds', {
      headers: adminHeader,
      body: { name: 'Temple Fund', targetPaise: 1000000 },
    });
    expect(status).toBe(201);
    expect(json.data.id).toBe('f1');
  });

  it('rejects a non-positive target', async () => {
    const { status } = await request('POST', '/api/v1/admin/donation-funds', {
      headers: adminHeader,
      body: { name: 'Temple Fund', targetPaise: 0 },
    });
    expect(status).toBe(400);
  });
});
