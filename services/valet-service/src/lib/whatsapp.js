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

/**
 * A free-form message, only legal inside the 24-hour customer-service window.
 *
 * The recipient goes inside `payload`, not beside it: MSG91's single-send
 * shape reads payload.to, and a number at the top level is a number it never
 * looks at -- the request is accepted and the message reaches nobody.
 */
export function sendText(waId, body) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'text',
    payload: {
      to: waId,
      type: 'text',
      messaging_product: 'whatsapp',
      text: { body },
    },
  });
}

/**
 * An approved template, for when the window has closed.
 *
 * Shaped to MSG91's bulk endpoint, which pairs each recipient with its own
 * variables in to_and_components rather than taking one `to` and one set of
 * components. We only ever send to one person, so the array has one entry --
 * but the field name is not optional.
 *
 * `language` is a bare string here. The { code: 'en' } form belongs to Meta's
 * Cloud API; sending it to MSG91 is a different API's vocabulary.
 */
export function sendTemplate(waId, templateName, vars = []) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'template',
    payload: {
      type: 'template',
      template: {
        name: templateName,
        language: 'en',
        to_and_components: [{
          to: waId,
          components: vars.map((text) => ({ type: 'text', text })),
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

/**
 * Flattens whatever the provider posted into { id, from, text }.
 *
 * MSG91 and Meta do not agree on the shape of an inbound message, and this
 * file is where that difference is supposed to stop. MSG91 posts its own
 * fields with the body as a JSON *string* in `content`; Meta nests everything
 * under messages[]. The route previously read only Meta's shape, so a real
 * MSG91 delivery would have parsed to nothing and been answered "ok" --
 * silently, on every guest message.
 *
 * Which fields MSG91 forwards is configurable per webhook, so the id and the
 * sender are each read from the few names they plausibly arrive under rather
 * than one. Returns null when there is no message to act on, which the caller
 * treats as a delivery report rather than an error.
 */
export function normalizeInbound(body) {
  if (!body || typeof body !== 'object') return null;

  const meta = Array.isArray(body.messages) ? body.messages[0] : null;
  if (meta?.id) {
    return { id: meta.id, from: String(meta.from ?? ''), text: meta.text?.body ?? '' };
  }

  const id = body.messageId ?? body.message_id ?? body.id;
  if (!id) return null;

  // `content` is a JSON envelope in MSG91's own docs, but a provider sending
  // the bare text must not throw its way into a 500 and a retry storm.
  let text = '';
  const raw = body.content;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      text = typeof parsed === 'string' ? parsed : (parsed?.text ?? parsed?.body ?? '');
    } catch {
      text = raw;
    }
  } else if (raw && typeof raw === 'object') {
    text = raw.text ?? raw.body ?? '';
  } else {
    text = body.text?.body ?? body.text ?? '';
  }

  return { id: String(id), from: String(body.from ?? body.mobile ?? body.sender ?? ''), text: String(text) };
}
