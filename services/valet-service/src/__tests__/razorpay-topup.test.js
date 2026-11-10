import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../db.js', () => ({
  default: {}, query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn() }));
vi.mock('../lib/whatsapp-guest.js', () => ({
  notifyGuest: vi.fn(async () => ({ status: 'sent' })),
  notifyCardHeld: vi.fn(async () => ({ status: 'sent' })),
}));

import { query, queryOne, queryRows } from '../db.js';
import adminRoutes from '../routes/admin.js';
import webhookRoutes from '../routes/webhooks.js';
import { settleAdOrder } from '../lib/ad-topups.js';
import { verifyPaymentSignature, verifyWebhookSignature, isPlaceholderMode } from '../lib/payments.js';
import { createApp, request, adminToken } from './helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay top-ups for the ad balance, in live mode.
//
// The rule every test here protects: a balance is credited when Razorpay says
// the money arrived, exactly once, and never on the browser's word alone.
// ─────────────────────────────────────────────────────────────────────────────

const admin = createApp(adminRoutes, '/admin');
const hooks = createApp(webhookRoutes, '/webhooks');

const GROUP = () => adminToken({ role: 'client_admin', account_id: 'acc-1', community_id: null });
const TERMS = {
  quota_mode: 'shared', quota_cars_per_property: 2000, quota_alert_percent: 80,
  quota_over_behaviour: 'bill', quota_overage_paise: 4000,
  ad_price_per_view_paise: 150, ad_monthly_minimum_paise: 200000,
  gst_percent: 18, ad_billing: 'prepaid',
};

const KEY_SECRET = 'rzp_secret_for_tests';
const WEBHOOK_SECRET = 'rzp_webhook_secret_for_tests';

const checkoutSignature = (orderId, paymentId, secret = KEY_SECRET) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
const webhookSignature = (body) =>
  crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');

function captured(orderId, paymentId, amount) {
  return {
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
  };
}

beforeEach(() => {
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'order_live123', amount: 590000, currency: 'INR' }),
  })));
});

afterEach(() => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
});

describe('payments: signatures', () => {
  it('accepts the signature Checkout returns for a real payment', () => {
    expect(verifyPaymentSignature('order_1', 'pay_1', checkoutSignature('order_1', 'pay_1'))).toBe(true);
  });

  it('refuses a signature made for a different payment, or with another secret', () => {
    expect(verifyPaymentSignature('order_1', 'pay_2', checkoutSignature('order_1', 'pay_1'))).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', checkoutSignature('order_1', 'pay_1', 'guess'))).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', 'short')).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', undefined)).toBe(false);
  });

  // No secret means nothing can be checked, so nothing is confirmed.
  it('confirms nothing in placeholder mode', () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(isPlaceholderMode()).toBe(true);
    expect(verifyPaymentSignature('order_1', 'pay_1', checkoutSignature('order_1', 'pay_1'))).toBe(false);
  });

  it('refuses every webhook when no webhook secret is configured', () => {
    const body = captured('order_1', 'pay_1', 100);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(verifyWebhookSignature(Buffer.from(JSON.stringify(body)), webhookSignature(body))).toBe(false);
  });
});

describe('POST /admin/ads/topup (live)', () => {
  it('opens an order and credits nothing until it is paid', async () => {
    queryOne.mockResolvedValueOnce(TERMS);

    const res = await request(admin, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 500000 },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orderId: 'order_live123', totalPaise: 590000,
      paymentPlaceholder: false, credited: false, keyId: 'rzp_test_key',
    });
    const sql = query.mock.calls.map(([q]) => q).join('\n');
    expect(sql).not.toMatch(/valet_ad_ledger/);
    expect(sql).toMatch(/INSERT INTO valet_ad_orders/);
  });

  // Frozen at order time: a GST rate changed mid-checkout must not change
  // what the payment is worth.
  it('records the net, the GST and the total charged against the order', async () => {
    queryOne.mockResolvedValueOnce(TERMS);

    await request(admin, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 500000 },
    });

    const [, params] = query.mock.calls.find(([q]) => /valet_ad_orders/.test(q));
    expect(params.slice(0, 5)).toEqual(['order_live123', 'acc-1', 500000, 90000, 590000]);
  });

  it('asks Razorpay for the total including GST', async () => {
    queryOne.mockResolvedValueOnce(TERMS);

    await request(admin, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 500000 },
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ amount: 590000, currency: 'INR' });
  });
});

describe('POST /admin/ads/topup/verify', () => {
  const sig = checkoutSignature('order_live123', 'pay_abc');

  it('refuses a success the server cannot verify, before touching the database', async () => {
    const res = await request(admin, 'POST', '/admin/ads/topup/verify', {
      token: GROUP(),
      body: { orderId: 'order_live123', paymentId: 'pay_abc', signature: checkoutSignature('order_live123', 'pay_abc', 'forged') },
    });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('credits a verified payment, only on an order the caller owns', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'l1' }], rowCount: 1 });

    const res = await request(admin, 'POST', '/admin/ads/topup/verify', {
      token: GROUP(), body: { orderId: 'order_live123', paymentId: 'pay_abc', signature: sig },
    });

    expect(res.status).toBe(200);
    expect(res.body.credited).toBe(true);
    const [q, params] = query.mock.calls[0];
    expect(q).toMatch(/account_id = \$4/);
    expect(params).toEqual(expect.arrayContaining(['order_live123', 'pay_abc', 'acc-1']));
  });

  // The webhook usually lands first. The venue must still be told it worked.
  it('reports success when the webhook already settled the order', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryOne.mockResolvedValueOnce({ status: 'paid' });

    const res = await request(admin, 'POST', '/admin/ads/topup/verify', {
      token: GROUP(), body: { orderId: 'order_live123', paymentId: 'pay_abc', signature: sig },
    });

    expect(res.status).toBe(200);
    expect(res.body.credited).toBe(true);
  });

  it('answers 404 for an order that is not this caller\'s', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryOne.mockResolvedValueOnce(null);

    const res = await request(admin, 'POST', '/admin/ads/topup/verify', {
      token: GROUP(), body: { orderId: 'order_live123', paymentId: 'pay_abc', signature: sig },
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /webhooks/razorpay', () => {
  const signedPost = (body) =>
    request(hooks, 'POST', '/webhooks/razorpay', {
      body, headers: { 'x-razorpay-signature': webhookSignature(body) },
    });

  it('refuses an unsigned delivery', async () => {
    const res = await request(hooks, 'POST', '/webhooks/razorpay', {
      body: captured('order_live123', 'pay_abc', 590000),
    });

    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('settles a captured payment, but only for the amount the order asked for', async () => {
    const res = await signedPost(captured('order_live123', 'pay_abc', 590000));

    expect(res.status).toBe(200);
    const [q, params] = query.mock.calls[0];
    expect(q).toMatch(/total_paise = \$4/);
    expect(params).toEqual(['order_live123', 'pay_abc', expect.any(String), 590000]);
  });

  // Razorpay retries anything that is not a 200, and eventually disables the
  // webhook, so events we do not act on are still acknowledged.
  it('acknowledges events it does not act on', async () => {
    const res = await signedPost({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } } });

    expect(res.status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('settleAdOrder', () => {
  it('flips only an unpaid order, and credits the order\'s net in the same statement', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'l1' }], rowCount: 1 });

    const credited = await settleAdOrder({ orderRef: 'order_1', paymentRef: 'pay_1' });

    expect(credited).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [q] = query.mock.calls[0];
    expect(q).toMatch(/status = 'created'/);
    expect(q).toMatch(/net_paise, 'topup'/);
    expect(q).toMatch(/ON CONFLICT \(order_ref\)/);
  });

  it('reports a replay as not credited', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await settleAdOrder({ orderRef: 'order_1', paymentRef: 'pay_1' })).toBe(false);
  });
});
