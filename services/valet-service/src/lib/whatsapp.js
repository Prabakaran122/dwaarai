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

const AUTHKEY_URL = 'https://console.authkey.io/restapi/requestjson.php';

const provider = () => process.env.WHATSAPP_PROVIDER || '';
const authKey = () => process.env.MSG91_AUTH_KEY || '';
const authkeyIoKey = () => process.env.AUTHKEY_API_KEY || '';
const fromNumber = () => process.env.WHATSAPP_NUMBER || '';
const defaultCountryCode = () => process.env.WHATSAPP_COUNTRY_CODE || '91';

export function isConfigured() {
  // No sender number: authkey.io takes only the recipient and sends from
  // whatever number the account has registered, and exposes no API to read
  // that back. WHATSAPP_NUMBER still matters -- it is the number printed on
  // the card for guests to message -- but requiring it to *send* would leave
  // every message silently skipped over a value the provider never sees.
  if (provider() === 'authkey') return !!authkeyIoKey();
  return provider() === 'msg91' && !!authKey() && !!fromNumber();
}

/**
 * authkey.io wants the country code and the subscriber number apart; we carry
 * one international string everywhere else, because that is what WhatsApp
 * hands us on an inbound message.
 *
 * A number that already arrives without a country code is left alone and given
 * the configured default -- guessing a code onto a ten-digit number is how a
 * message ends up in another country.
 */
export function splitNumber(waId, fallbackCc = defaultCountryCode()) {
  const digits = String(waId || '').replace(/\D/g, '');
  if (digits.length > 10) {
    return { country_code: digits.slice(0, digits.length - 10), mobile: digits.slice(-10) };
  }
  return { country_code: fallbackCc, mobile: digits };
}

/**
 * One send, authkey.io's way.
 *
 * Reports rather than throws, exactly as the MSG91 path does. Note this
 * provider answers HTTP 200 with { success: false } on a rejected send, so
 * reading the status code alone would call a failure a delivery.
 */
async function postAuthkey(body) {
  if (!isConfigured()) return { status: 'skipped' };
  try {
    const res = await fetch(AUTHKEY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authkeyIoKey()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    // Two shapes, because authkey.io does not answer consistently across its
    // own endpoints: requestjson.php returns { status: 'Success', LogID, ... }
    // while getbalance.php returns { success: true }. Reading only the boolean
    // reported every real delivery as failed -- and through the template
    // fallback that means messaging the guest twice.
    const ok = data?.success === true
      || String(data?.status || '').toLowerCase() === 'success';
    return ok ? { status: 'sent' } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
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
  if (provider() === 'authkey') {
    // Undocumented on this provider, whose every published path carries a
    // template id. Attempted rather than assumed away: if it is rejected the
    // caller sees 'failed' and falls back to a template, which always works.
    return postAuthkey({
      ...splitNumber(waId),
      type: 'text',
      body,
    });
  }
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
  if (provider() === 'authkey') {
    // `wid` is a numeric template id from the authkey.io console, not a name.
    // Variables are named var1..varN there, in the order the template declares
    // its {#placeholders#}.
    const bodyValues = {};
    vars.forEach((v, i) => { bodyValues[`var${i + 1}`] = v; });
    return postAuthkey({
      ...splitNumber(waId),
      wid: String(templateName),
      type: 'text',
      bodyValues,
    });
  }
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

/**
 * Constant-time compare of a shared secret carried in the webhook URL.
 *
 * For providers that cannot sign. authkey.io's webhook console offers a URL,
 * a method and a JSON toggle -- and no signing secret of any kind, so an HMAC
 * check would reject every message it ever sent.
 *
 * This is genuinely weaker than a signature: it authenticates the caller but
 * proves nothing about the body, so a tampered payload from someone holding
 * the URL would pass. It is therefore the fallback, consulted only when no
 * signature is offered, and the URL must be treated as a credential -- it
 * belongs in the provider's console, never in a log or a bug report.
 */
export function verifyUrlToken(token) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  if (!secret || !token) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
