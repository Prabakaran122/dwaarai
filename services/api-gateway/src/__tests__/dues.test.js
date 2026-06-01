import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

vi.mock('../../src/lib/razorpay.js', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'order_test_1', amount: 500000, currency: 'INR', test_mode: true }),
  verifyWebhookSignature: vi.fn((_raw, sig) => sig === 'good'),
  getKeyId: vi.fn(() => null),
  isLiveMode: vi.fn(() => false),
}));

vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => { query.mockReset(); queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'unit1', name: 'Asha' });
const admin = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'Treasurer' });

describe('Dues payment', () => {
  it('GET /dues sums outstanding with penalty broken out', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'd1', period: '2026-05', description: 'Maintenance', base_amount: '4000.00', penalty_amount: '200.00', due_date: '2026-05-10', status: 'pending', created_at: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/dues', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.dues[0].base_amount).toBe(4000);
    expect(json.data.dues[0].penalty_amount).toBe(200);
    expect(json.data.dues[0].total_amount).toBe(4200);
    expect(json.data.outstanding).toBe(4200);
  });

  it('POST /dues/:id/pay creates an order for a pending due', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'd1', base_amount: '4000.00', penalty_amount: '0', status: 'pending' }) // due lookup
      .mockResolvedValueOnce({ id: 'p1' }); // inserted payment
    const { status, json } = await request('POST', '/api/v1/dues/d1/pay', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(201);
    expect(json.data.order_id).toBe('order_test_1');
    expect(json.data.amount).toBe(400000); // 4000.00 * 100, computed server-side
    expect(json.data.test_mode).toBe(true);
  });

  it('POST /dues/:id/pay rejects an already-paid due', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1', base_amount: '4000', penalty_amount: '0', status: 'paid' });
    const { status } = await request('POST', '/api/v1/dues/d1/pay', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(409);
  });

  it('resident cannot create a due (admin only)', async () => {
    const { status } = await request('POST', '/api/v1/dues', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { unit_number: 'A-1', period: '2026-05', base_amount: 4000 },
    });
    expect(status).toBe(403);
  });

  it('admin POST /dues creates a due for a unit', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'unit1' }) // unit lookup
      .mockResolvedValueOnce({ id: 'd2', period: '2026-05', description: null, base_amount: '4000', penalty_amount: '0', due_date: null, status: 'pending', created_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/dues', {
      headers: { Authorization: `Bearer ${admin}` },
      body: { unit_number: 'A-704', period: '2026-05', base_amount: 4000 },
    });
    expect(status).toBe(201);
    expect(json.data.status).toBe('pending');
  });

  it('admin mark-paid records a manual payment', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1', unit_id: 'unit1', base_amount: '4000', penalty_amount: '0', status: 'pending' });
    const { status, json } = await request('POST', '/api/v1/dues/d1/mark-paid', { headers: { Authorization: `Bearer ${admin}` } });
    expect(status).toBe(200);
    expect(json.data.status).toBe('paid');
    expect(json.data.receipt_no).toMatch(/^DW-/);
  });

  it('webhook rejects a bad signature', async () => {
    const { status } = await request('POST', '/api/v1/payments/webhook', {
      headers: { 'x-razorpay-signature': 'bad' },
      body: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_test_1' } } } },
    });
    expect(status).toBe(401);
  });

  it('webhook with valid signature marks the payment and due paid', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1', due_id: 'd1', resident_id: 'r1', amount: '4000' }) // payment by order
      .mockResolvedValueOnce({ fcm_token: null }); // resident push lookup
    const { status, json } = await request('POST', '/api/v1/payments/webhook', {
      headers: { 'x-razorpay-signature': 'good' },
      body: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_test_1' } } } },
    });
    expect(status).toBe(200);
    expect(json.data.received).toBe(true);
    // payment + due updates
    expect(query).toHaveBeenCalled();
  });
});
