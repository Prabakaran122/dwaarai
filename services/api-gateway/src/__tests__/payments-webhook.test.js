import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Same mocking pattern as dues.test.js — this file exercises the SAME
// POST /payments/webhook handler in routes/dues.js. The dues branch must
// keep working byte-for-byte; the stall/donation branches are new.
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
const { query, queryOne } = await import('../db/queries.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => { query.mockReset(); queryOne.mockReset(); });

async function postWebhook(signature, payload) {
  const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const capturedPayload = (orderId) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: orderId } } },
});

describe('POST /payments/webhook — existing dues branch (UNTOUCHED, live, taking money)', () => {
  it('rejects a bad signature with 401 and writes nothing', async () => {
    const { status } = await postWebhook('bad', capturedPayload('order_test_1'));
    expect(status).toBe(401);
    expect(queryOne).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('valid signature marks the due payment and due paid, exactly as before', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1', due_id: 'd1', resident_id: 'r1', amount: '4000' }) // due_payments lookup by order id
      .mockResolvedValueOnce({ fcm_token: null }); // resident push lookup
    const { status, json } = await postWebhook('good', capturedPayload('order_test_1'));
    expect(status).toBe(200);
    expect(json.data.received).toBe(true);
    // due_payments + dues updates via `query`
    expect(query).toHaveBeenCalled();
    const sqlCalls = query.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE due_payments'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE dues'))).toBe(true);
  });
});

describe('POST /payments/webhook — stall settlement', () => {
  it('flips a stall order to paid and the booking to booked, stamping booked_at', async () => {
    queryOne.mockResolvedValueOnce(null); // no due_payments row for this order — not a dues payment
    query
      // UPDATE payment_orders ... WHERE status = 'created' RETURNING ...
      .mockResolvedValueOnce({
        rows: [{ id: 'order1', purpose: 'stall', subject_id: 'booking1', community_id: 'c1', amount_paise: 103000, platform_fee_paise: 3000 }],
        rowCount: 1,
      })
      // UPDATE stall_bookings SET status = 'booked', booked_at = NOW() WHERE id = ... AND status = 'reserved'
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { status, json } = await postWebhook('good', capturedPayload('order_stall_1'));
    expect(status).toBe(200);
    expect(json.data.received).toBe(true);

    const sqlCalls = query.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE payment_orders') && sql.includes("status = 'created'"))).toBe(true);
    const bookingCall = query.mock.calls.find((c) => c[0].includes('UPDATE stall_bookings'));
    expect(bookingCall).toBeTruthy();
    expect(bookingCall[0]).toMatch(/booked_at\s*=\s*NOW\(\)/);
    expect(bookingCall[0]).toMatch(/status\s*=\s*'booked'/);
    expect(bookingCall[1]).toContain('booking1');
  });
});

describe('POST /payments/webhook — donation settlement', () => {
  it('flips a donation order and the donation to paid so fund progress moves', async () => {
    queryOne.mockResolvedValueOnce(null); // not a dues payment
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'order2', purpose: 'donation', subject_id: 'donation1', community_id: 'c1', amount_paise: 50000, platform_fee_paise: 0 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE donations

    const { status, json } = await postWebhook('good', capturedPayload('order_donation_1'));
    expect(status).toBe(200);
    expect(json.data.received).toBe(true);

    const donationCall = query.mock.calls.find((c) => c[0].includes('UPDATE donations'));
    expect(donationCall).toBeTruthy();
    expect(donationCall[0]).toMatch(/status\s*=\s*'paid'/);
    expect(donationCall[1]).toContain('donation1');
  });
});

describe('POST /payments/webhook — unknown order id', () => {
  it('returns 200 with no writes beyond the lookup attempts', async () => {
    queryOne.mockResolvedValueOnce(null); // not a dues payment
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no matching payment_orders row either

    const { status, json } = await postWebhook('good', capturedPayload('order_unknown'));
    expect(status).toBe(200);
    expect(json.data.received).toBe(true);
    // Only the payment_orders lookup/update attempt — no booking or donation writes.
    expect(query).toHaveBeenCalledTimes(1);
    const sqlCalls = query.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE stall_bookings'))).toBe(false);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE donations'))).toBe(false);
  });
});

describe('POST /payments/webhook — replay (gateway retries the same delivery)', () => {
  it('delivering the same payment.captured twice books the stall exactly once', async () => {
    // First delivery: order is 'created' -> the conditional UPDATE matches and settles it.
    queryOne.mockResolvedValueOnce(null);
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'order1', purpose: 'stall', subject_id: 'booking1', community_id: 'c1', amount_paise: 103000, platform_fee_paise: 3000 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const first = await postWebhook('good', capturedPayload('order_stall_replay'));
    expect(first.status).toBe(200);

    // Second delivery (replay): order is already 'paid', so `WHERE status = 'created'`
    // matches zero rows. This must be detected by row count, NOT by a prior read.
    queryOne.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const second = await postWebhook('good', capturedPayload('order_stall_replay'));
    expect(second.status).toBe(200);
    expect(second.json.data.received).toBe(true);

    // Across both deliveries, stall_bookings was promoted to 'booked' exactly once.
    const bookingCalls = query.mock.calls.filter((c) => c[0].includes('UPDATE stall_bookings'));
    expect(bookingCalls.length).toBe(1);
  });
});
