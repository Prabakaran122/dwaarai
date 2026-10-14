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
 * Placeholder mode is not a test fixture. It is the mode this deployment runs
 * in until the Razorpay Route question (BRD OQ-01) is decided, and every caller
 * surfaces it so a venue is never told money moved when it did not.
 */

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

export function isPlaceholderMode() {
  return !(KEY_ID && KEY_SECRET);
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

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
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
