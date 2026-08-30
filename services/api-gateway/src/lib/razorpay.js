import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Payment gateway. Razorpay over REST (no SDK dependency).
 *
 * Two modes, and which one is running is never left to chance:
 *
 *   live        — RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are set. Real orders,
 *                 real money, webhook signatures verified.
 *   placeholder — no keys. Orders are minted locally so the whole booking and
 *                 donation flow can be exercised end to end, but NO money moves.
 *
 * Placeholder mode is deliberate scaffolding while the Razorpay account and the
 * settlement model (BRD open question OQ-01: split payment via Route vs manual
 * payout) are still being decided. It is safe in dev and it is a liability in
 * production: a stall would read as "booked" and a donation as received while
 * nothing was ever collected.
 *
 * So in production it must be opted into explicitly with
 * PAYMENTS_PLACEHOLDER=true. Missing keys in production without that flag is a
 * startup failure, not a silent downgrade — the failure mode this prevents is
 * a deploy that looks healthy while quietly taking no money at all.
 */

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const PLACEHOLDER_ACKNOWLEDGED = process.env.PAYMENTS_PLACEHOLDER === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const PAYMENTS_MODE = KEY_ID && KEY_SECRET ? 'live' : 'placeholder';

if (PAYMENTS_MODE === 'placeholder' && IS_PRODUCTION && !PLACEHOLDER_ACKNOWLEDGED) {
  throw new Error(
    'Payment gateway is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, ' +
    'or set PAYMENTS_PLACEHOLDER=true to run deliberately without collecting money.'
  );
}

if (PAYMENTS_MODE === 'placeholder') {
  console.warn(
    '[payments] PLACEHOLDER MODE — orders are minted locally and no money is collected. ' +
    'Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to go live.'
  );
}

export function isLiveMode() {
  return PAYMENTS_MODE === 'live';
}

/** True when orders are fake. Routes surface this so a client can say so. */
export function isPlaceholderMode() {
  return PAYMENTS_MODE === 'placeholder';
}

export function getKeyId() {
  return KEY_ID || null;
}

/**
 * Create a payment order.
 *
 * @param {number} amountPaise integer amount in paise
 * @param {string} receipt short receipt identifier
 * @returns {Promise<{id:string, amount:number, currency:string, test_mode:boolean, placeholder:boolean}>}
 */
export async function createOrder(amountPaise, receipt) {
  if (!isLiveMode()) {
    // Prefixed so a placeholder order is identifiable anywhere it surfaces —
    // a database row, a log line, a support conversation — without needing to
    // know which env produced it.
    return {
      id: `order_placeholder_${uuidv4().replace(/-/g, '').slice(0, 14)}`,
      amount: amountPaise,
      currency: 'INR',
      test_mode: true,
      placeholder: true,
    };
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
  return { id: order.id, amount: order.amount, currency: order.currency, test_mode: false, placeholder: false };
}

/**
 * Verify a Razorpay webhook signature against the raw request body.
 *
 * Returns false in placeholder mode rather than true: an unsigned callback must
 * never be able to mark an order paid, and a placeholder deployment has no
 * legitimate webhook traffic to accept in the first place.
 *
 * @param {Buffer|string} rawBody exact bytes received
 * @param {string} signature value of the X-Razorpay-Signature header
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    // Length mismatch throws before any comparison — treat as a failed verify.
    return false;
  }
}
