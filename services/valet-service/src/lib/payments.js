import crypto from 'crypto';

/**
 * Payment orders for valet advertising.
 *
 * Mirrors api-gateway's razorpay.js rather than importing it: there is no
 * shared package in this repo, and every service already carries its own db.js
 * and route scaffolding. The contract is the part that matters and it is the
 * same one -- an order id, and an honest flag saying whether any money can
 * actually move.
 *
 * Placeholder mode is not a test fixture. It is the mode a deployment runs in
 * until Razorpay keys are set, and every caller surfaces it so a venue is never
 * told money moved when it did not. Ad top-ups are paid to Dwaar AI itself, so
 * they do not wait on the Razorpay Route question (BRD OQ-01) the way guest
 * payments to a venue would.
 *
 * The keys are read on every call, not captured at import: a test (or a
 * restart-free config reload) that sets them after this module loads must see
 * them, and a stale empty key reads as placeholder mode in live.
 */

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || '';

export function isPlaceholderMode() {
  return !(keyId() && keySecret());
}

/** The public half of the key pair, which the checkout in the browser needs. */
export function getKeyId() {
  return keyId() || null;
}

function safeEqualHex(expected, given) {
  if (typeof given !== 'string' || !given) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    // Length mismatch throws before any comparison -- a failed verify.
    return false;
  }
}

/**
 * @param {number} amountPaise integer paise
 * @param {string} receipt short identifier carried into the ledger
 */
export async function createAdOrder(amountPaise, receipt) {
  if (isPlaceholderMode()) {
    // Prefixed so a placeholder order is identifiable in a ledger row, a log
    // line or a support conversation without knowing which env produced it.
    return {
      id: `order_placeholder_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
      amountPaise,
      currency: 'INR',
      placeholder: true,
    };
  }

  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise, currency: 'INR', receipt, payment_capture: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Razorpay order creation failed (${res.status}): ${text}`);
  }
  const order = await res.json();
  return { id: order.id, amountPaise: order.amount, currency: order.currency, placeholder: false };
}

/**
 * The signature Checkout hands back to the browser on success:
 * HMAC-SHA256 of "<order id>|<payment id>" under the key secret.
 *
 * Only the server holds the secret, so a browser cannot forge a success for an
 * order it never paid. False in placeholder mode: there is no secret to check
 * against, and no real payment to confirm.
 */
export function verifyPaymentSignature(orderId, paymentId, signature) {
  if (isPlaceholderMode() || !orderId || !paymentId) return false;
  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/**
 * A Razorpay webhook, checked against the exact bytes received.
 *
 * The webhook secret is a different value from the key secret -- it is chosen
 * when the webhook is created in the Razorpay dashboard. Unset means every
 * webhook is refused: an unsigned callback must never be able to credit a
 * balance.
 *
 * @param {Buffer|string} rawBody exact bytes received
 * @param {string} signature value of the X-Razorpay-Signature header
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
