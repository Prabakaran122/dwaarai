import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne } from '../db.js';
import { verifySignature, verifyUrlToken, normalizeInbound } from '../lib/whatsapp.js';
import { notifyGuest, notifyCardHeld } from '../lib/whatsapp-guest.js';
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
  if (status === 'retrieval_requested') return 'accepted';
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
  // A signature when the provider offers one, the URL token when it cannot.
  // Preferring the signature means a provider that can sign is never silently
  // downgraded to the weaker check just because a token is also present.
  const signature = req.headers['x-whatsapp-signature'];
  const authentic = signature
    ? verifySignature(req.rawBody, signature)
    : verifyUrlToken(req.query.token);
  if (!authentic) {
    return res.status(401).json({ error: 'bad_signature' });
  }

  // Normalised here rather than read inline: MSG91 and Meta disagree on the
  // shape, and this route should not know which provider is configured.
  const message = normalizeInbound(req.body);
  if (!message?.id) return res.status(200).json({ ok: true });

  // Checked before anything is acted on. The UNIQUE constraint is what makes
  // a provider retry a no-op rather than a second car request.
  const seen = await queryOne(
    'SELECT id FROM valet_whatsapp_messages WHERE provider_message_id = $1',
    [message.id]
  );
  if (seen) return res.status(200).json({ ok: true, duplicate: true });

  const code = extractCode(message.text);

  // No code is the normal case, not an error. The welcome message says
  // "Reply CAR when you want it brought round", and CAR is three characters
  // where the claim-code pattern needs six -- so following our own
  // instruction resolved to nothing and the guest was ignored.
  //
  // WhatsApp guarantees the sender's number, and the number is already bound
  // to the ticket, so it identifies them on its own. Most recent open ticket,
  // because a returning guest may have several across a stay.
  if (!code) {
    const own = await queryOne(
      `SELECT t.*, c.name AS community_name
         FROM valet_tickets t
         JOIN communities c ON c.id = t.community_id
        WHERE t.phone_number = $1 AND t.status NOT IN ('final_closed', 'expired')
        ORDER BY t.created_at DESC
        LIMIT 1`,
      [message.from]
    );
    await recordInbound(message.id, own?.id || null);
    if (!own) return res.status(200).json({ ok: true, unmatched: true });
    return handleTicket(res, own, message);
  }

  let ticket = await queryOne(
    `SELECT t.*, c.name AS community_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
      WHERE t.claim_code = $1 AND t.status NOT IN ('final_closed', 'expired')
      LIMIT 1`,
    [code]
  );

  // Same alphabet and length as a claim code, so a six-character token may be
  // either. Claim code first; failing that, a card's own reference -- which is
  // what the guest carries when the guard has only started intake.
  const card = ticket ? null : await queryOne(
    `SELECT c.id, c.pending_wa_phone, cm.name AS community_name,
            t.id AS ticket_id, t.session_token, t.claim_code, t.phone_number,
            t.status, t.display_id, t.plate, t.vehicle_make,
            t.whatsapp_last_inbound_at
       FROM valet_cards c
       JOIN communities cm ON cm.id = c.community_id
       LEFT JOIN valet_tickets t
         ON t.card_id = c.id AND t.status NOT IN ('final_closed', 'expired')
      WHERE c.wa_ref = $1 AND c.is_active = true
      LIMIT 1`,
    [code]
  );

  await recordInbound(message.id, ticket?.id || card?.ticket_id || null);

  // The card is known but its car is not checked in yet. Hold the number on
  // the card; intake will claim it and send the real welcome.
  if (!ticket && card && !card.ticket_id) {
    await query(
      `UPDATE valet_cards SET pending_wa_phone = $2, pending_wa_at = NOW() WHERE id = $1`,
      [card.id, message.from]
    );
    await notifyCardHeld(message.from, card.community_name);
    return res.status(200).json({ ok: true, held: true });
  }

  if (!ticket && card?.ticket_id) {
    ticket = { ...card, id: card.ticket_id };
  }

  if (!ticket) return res.status(200).json({ ok: true, unmatched: true });

  return handleTicket(res, ticket, message);
});

export default router;


/**
 * Everything that happens once a ticket has been identified.
 *
 * Shared because there are now two ways to arrive here -- a claim code in
 * the message, or the sender s own number when they wrote no code -- and
 * the two must behave identically from this point on.
 */
async function handleTicket(res, ticket, message) {
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
  if (REQUEST_PATTERN.test(message.text || '') && REQUESTABLE.includes(ticket.status)) {
    await query(`UPDATE valet_tickets SET status = 'retrieval_requested' WHERE id = $1`, [ticket.id]);
    await logEvent(ticket.id, 'requested', { metadata: { via: 'whatsapp' } });
    await notifyGuest({ ...fresh, status: 'retrieval_requested' }, 'accepted');
    return res.status(200).json({ ok: true, requested: true });
  }

  await notifyGuest(fresh, statusKind(ticket.status));
  return res.status(200).json({ ok: true });
}