import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne } from '../db.js';
import { verifySignature } from '../lib/whatsapp.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import { normalizeClaimCode } from '../lib/claim-code.js';
import { logEvent } from '../lib/events.js';

const router = asyncRouter();

/**
 * Inbound WhatsApp.
 *
 * Public by necessity, so the signature is the only thing between this route
 * and anyone who knows the URL. It is checked against the raw bytes before a
 * single query runs.
 *
 * Every path answers 200 once the signature is good, including paths that do
 * nothing: a non-200 tells the provider to retry, forever, for a message we
 * were never going to act on.
 */

// Six characters from the claim-code alphabet, which deliberately omits O, I,
// S, 0, 1 and 5. That makes this specific enough that ordinary words in a
// greeting do not match it.
const CODE_PATTERN = /\b[ABCDEFGHJKLMNPQRTUVWXYZ23456789]{6}\b/i;

function extractCode(text) {
  const found = String(text || '').toUpperCase().match(CODE_PATTERN);
  return found ? normalizeClaimCode(found[0]) : null;
}

// One intent is worth recognising. Anything else gets status and a link
// rather than an attempt at conversation.
const REQUEST_PATTERN = /\b(car|gaadi|vehicle|bring|ready|pick\s*up|pickup)\b/i;

const REQUESTABLE = ['parked', 'parked_again'];

/** What to tell a guest whose message was not a request we could act on. */
function statusKind(status) {
  if (status === 'arrived') return 'arrived';
  if (status === 'en_route') return 'en_route';
  if (status === 'requested') return 'accepted';
  return 'bound';
}

function recordInbound(messageId, ticketId) {
  return query(
    `INSERT INTO valet_whatsapp_messages (provider_message_id, ticket_id, direction)
     VALUES ($1, $2, 'in') ON CONFLICT DO NOTHING`,
    [messageId, ticketId]
  );
}

router.post('/whatsapp', async (req, res) => {
  if (!verifySignature(req.rawBody, req.headers['x-whatsapp-signature'])) {
    return res.status(401).json({ error: 'bad_signature' });
  }

  const message = req.body?.messages?.[0];
  if (!message?.id) return res.status(200).json({ ok: true });

  // Checked before anything is acted on. The UNIQUE constraint is what makes
  // a provider retry a no-op rather than a second car request.
  const seen = await queryOne(
    'SELECT id FROM valet_whatsapp_messages WHERE provider_message_id = $1',
    [message.id]
  );
  if (seen) return res.status(200).json({ ok: true, duplicate: true });

  const code = extractCode(message.text?.body);
  if (!code) {
    await recordInbound(message.id, null);
    return res.status(200).json({ ok: true, unmatched: true });
  }

  const ticket = await queryOne(
    `SELECT t.*, c.name AS community_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
      WHERE t.claim_code = $1 AND t.status NOT IN ('final_closed', 'expired')
      LIMIT 1`,
    [code]
  );

  await recordInbound(message.id, ticket?.id || null);
  if (!ticket) return res.status(200).json({ ok: true, unmatched: true });

  if (ticket.phone_number && ticket.phone_number !== message.from) {
    // The window still refreshes so we could answer them, but the ticket does
    // not move to whoever scanned the screen last.
    await query(
      'UPDATE valet_tickets SET whatsapp_last_inbound_at = NOW() WHERE id = $1',
      [ticket.id]
    );
    return res.status(200).json({ ok: true, alreadyBound: true });
  }

  const firstBind = !ticket.phone_number;
  await query(
    `UPDATE valet_tickets
        SET phone_number = $2,
            phone_consent_at = COALESCE(phone_consent_at, NOW()),
            whatsapp_last_inbound_at = NOW()
      WHERE id = $1`,
    [ticket.id, message.from]
  );

  const fresh = {
    ...ticket,
    phone_number: message.from,
    whatsapp_last_inbound_at: new Date().toISOString(),
  };

  if (firstBind) {
    await logEvent(ticket.id, 'whatsapp_bound');
    await notifyGuest(fresh, 'bound');
    return res.status(200).json({ ok: true });
  }

  // Acted on by status, not by wording. A guest asking for a car already on
  // its way must not summon a second valet for it.
  if (REQUEST_PATTERN.test(message.text?.body || '') && REQUESTABLE.includes(ticket.status)) {
    await query(`UPDATE valet_tickets SET status = 'requested' WHERE id = $1`, [ticket.id]);
    await logEvent(ticket.id, 'requested', { metadata: { via: 'whatsapp' } });
    await notifyGuest({ ...fresh, status: 'requested' }, 'accepted');
    return res.status(200).json({ ok: true, requested: true });
  }

  await notifyGuest(fresh, statusKind(ticket.status));
  return res.status(200).json({ ok: true });
});

export default router;
