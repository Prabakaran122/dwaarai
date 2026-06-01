import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Razorpay integration via REST (no SDK dependency).
// Configure with env vars in production:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   — for creating orders + client checkout
//   RAZORPAY_WEBHOOK_SECRET                — for verifying webhook signatures
// When keys are absent (local/dev), createOrder returns a clearly-marked test order
// so the app flow can be exercised without a live gateway.

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export function isLiveMode() {
  return Boolean(KEY_ID && KEY_SECRET);
}

export function getKeyId() {
  return KEY_ID || null;
}

/**
 * Create a Razorpay order.
 * @param {number} amountPaise integer amount in paise
 * @param {string} receipt short receipt identifier
 * @returns {Promise<{id:string, amount:number, currency:string, test_mode:boolean}>}
 */
export async function createOrder(amountPaise, receipt) {
  if (!isLiveMode()) {
    // Dev/test fallback — no real gateway call.
    return { id: `order_test_${uuidv4().replace(/-/g, '').slice(0, 14)}`, amount: amountPaise, currency: 'INR', test_mode: true };
  }

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Razorpay order creation failed (${res.status}): ${text}`);
  }
  const order = await res.json();
  return { id: order.id, amount: order.amount, currency: order.currency, test_mode: false };
}

/**
 * Verify a Razorpay webhook signature against the raw request body.
 * @param {Buffer|string} rawBody exact bytes received
 * @param {string} signature value of the X-Razorpay-Signature header
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
