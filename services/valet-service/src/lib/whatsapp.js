import crypto from 'crypto';

/**
 * Transport only.
 *
 * Everything about *what* to say lives in whatsapp-guest.js; this file knows
 * how to put bytes on the wire and how to check a signature. Swapping MSG91
 * for Meta's Cloud API should touch nothing else -- the same split storage.js
 * uses for S3 versus local disk.
 */

const MSG91_WHATSAPP_URL =
  'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

const provider = () => process.env.WHATSAPP_PROVIDER || '';
const authKey = () => process.env.MSG91_AUTH_KEY || '';
const fromNumber = () => process.env.WHATSAPP_NUMBER || '';

export function isConfigured() {
  return provider() === 'msg91' && !!authKey() && !!fromNumber();
}

/**
 * Reports rather than throws, on every path.
 *
 * By the time any of this runs the car is already in the venue's hands. A
 * messaging failure must not become a failed ticket operation, and an
 * unconfigured deployment must say it sent nothing rather than claim success
 * -- the same rule sms.js follows, for the same reason.
 */
async function post(payload) {
  if (!isConfigured()) return { status: 'skipped' };
  try {
    const res = await fetch(MSG91_WHATSAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data?.type === 'error' ? { status: 'failed' } : { status: 'sent' };
  } catch {
    return { status: 'failed' };
  }
}

export function sendText(waId, body) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'text',
    to: waId,
    payload: { type: 'text', text: { body } },
  });
}

export function sendTemplate(waId, templateName, vars = []) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'template',
    to: waId,
    payload: {
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: vars.map((text) => ({ type: 'text', text })),
        }],
      },
    },
  });
}

/**
 * Verifies over the RAW body, never the parsed object: re-serialising JSON
 * reorders keys and changes whitespace, either of which changes the hash.
 * Mirrors api-gateway's razorpay.js.
 */
export function verifySignature(rawBody, signature) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
