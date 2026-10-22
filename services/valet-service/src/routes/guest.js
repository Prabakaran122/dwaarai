import { createHash } from 'node:crypto';
import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne } from '../db.js';
import { newRotatingToken } from '../lib/tokens.js';
import { toDataUrl } from '../lib/qr.js';
import { logEvent } from '../lib/events.js';
import { normalizeClaimCode } from '../lib/claim-code.js';
import { handedOver, lastArrivalAt } from '../lib/handover.js';
import { issueDiscountCode } from '../lib/discount.js';
import { storage } from '../lib/storage.js';
import { emitTicketUpdate } from '../lib/realtime.js';

const router = asyncRouter();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROTATING_TTL_SECONDS = Number(process.env.ROTATING_TOKEN_TTL_SECONDS || 18);

/**
 * The guest side is deliberately unauthenticated. A guest scans a physical QR
 * card and lands here with nothing but a session token; there is no login, no
 * app install, and no account. The token is the only credential, so every
 * handler below resolves exactly one ticket by it and nothing else.
 */
function findTicket(sessionToken) {
  return queryOne(
    `SELECT t.*, c.name AS community_name,
            c.config->>'valetLogoKey' AS venue_logo_key,
            (c.config->>'valetAdvertisingEnabled')::boolean AS promo_enabled,
            c.config->>'valetPromoLabel' AS promo_label,
            c.config->>'valetPromoLink'  AS promo_link,
            pr.id AS promo_id, pr.headline AS promo_headline, pr.body AS promo_body,
            pr.image_key AS promo_image_key, pr.offer_code AS promo_offer_code,
            pr.button_label AS promo_button_label, pr.button_url AS promo_button_url,
            cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
       -- The one live promotion, if any. A unique partial index guarantees
       -- there is at most one, so no ordering is needed to pick it.
       LEFT JOIN valet_promotions pr
              ON pr.community_id = t.community_id
             AND pr.status = 'live'
             AND (pr.starts_at IS NULL OR pr.starts_at <= NOW())
             AND (pr.ends_at   IS NULL OR pr.ends_at   >= NOW())
             -- The hours of the day it runs. Null at both ends means all day,
             -- which is almost every promotion; the pair exists so a breakfast
             -- buffet is not advertised at midnight.
             --
             -- A window that wraps past midnight (22:00 to 02:00) is the
             -- reason for the OR rather than a plain BETWEEN: a late-bar offer
             -- is exactly the kind that wants those hours, and a BETWEEN would
             -- silently never match it.
             AND (
               pr.show_from IS NULL OR pr.show_to IS NULL
               OR (pr.show_from <= pr.show_to
                     AND NOW()::time BETWEEN pr.show_from AND pr.show_to)
               OR (pr.show_from > pr.show_to
                     AND (NOW()::time >= pr.show_from OR NOW()::time <= pr.show_to))
             )
       -- LEFT: a car logged from the desk has no attendant on it yet.
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
      WHERE t.session_token = $1`,
    [sessionToken]
  );
}

/**
 * A missing ticket and an expired one return the identical body, so probing
 * tokens learns nothing about which ones ever existed.
 */
function notFound(res) {
  return res.status(404).json({ error: 'not_found', message: 'This valet link is invalid or has expired.' });
}

/** Minutes a car may stand at the pickup point before it is flagged. */
const COLLECTION_WINDOW_MS = Number(process.env.COLLECTION_WINDOW_MINUTES || 5) * 60000;

function guestView(t, isHandedOver = false, arrivedAt = null) {
  // Counts down from the guard's estimate, and floors at 0 rather than going
  // negative, so a guard running slightly behind shows "any moment now"
  // instead of a confusing negative number.
  let etaSeconds = null;
  if (t.status === 'en_route' && t.eta_minutes && t.en_route_started_at) {
    const targetMs = new Date(t.en_route_started_at).getTime() + t.eta_minutes * 60000;
    etaSeconds = Math.max(0, Math.round((targetMs - Date.now()) / 1000));
  }

  return {
    displayId: t.display_id,
    plate: t.plate,
    vehicleMake: t.vehicle_make,
    venueName: t.community_name,
    status: t.status,
    elapsedMinutes: Math.max(0, Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000)),
    // Whoever is handling the current pickup, which on a later visit may be a
    // different person from the one who took the car in.
    guardName: ['en_route', 'arrived'].includes(t.status) ? t.current_guard_name : null,
    etaSeconds,
    // Always present once a ticket exists: the guard who took the car in.
    dropOffGuardName: t.created_guard_name,
    // True from the scan, not from the guard's later confirm-pickup: by the
    // time the car is formally closed the guest is in traffic.
    handedOver: isHandedOver,
    // Whether a logo exists, never where it lives. The file is fetched back
    // through the session token, so no storage key or community id crosses to
    // the guest.
    hasVenueLogo: !!t.venue_logo_key,
    // Only a guest actually holding a printed card should be asked to hand it
    // back; a screen-QR guest never had one.
    hasCard: !!t.card_code,
    // The flag decides, not the copy. Promo text outlives advertising being
    // switched off, and a venue that stopped paying should stop showing.
    // Counted from the arrival event, not from when the page was opened:
    // reopening it must not restart the window, because the car has been at
    // the door either way. The server-side sweep is the real enforcement;
    // this is what the guest sees.
    collectBySeconds: t.status === 'arrived' && arrivedAt
      ? Math.max(0, Math.round(
          (new Date(arrivedAt).getTime() + COLLECTION_WINDOW_MS - Date.now()) / 1000
        ))
      : null,
    // The banner, when a venue is running one. Falls back to the old single
    // line of config text, which plenty of venues still use and which costs
    // nothing to keep working.
    promo: t.promo_id
      ? {
          id: t.promo_id,
          headline: t.promo_headline,
          body: t.promo_body ?? null,
          hasImage: !!t.promo_image_key,
          buttonLabel: t.promo_button_label ?? null,
          buttonUrl: t.promo_button_url ?? null,
          // This guest's own copy of the code: the promotion's stem plus their
          // claim code. That is what makes a redemption traceable to one car
          // on one night rather than to "somebody saw a poster".
          guestCode: t.promo_offer_code && t.claim_code
            ? `${t.promo_offer_code}-${t.claim_code}`
            : null,
        }
      : t.promo_enabled && t.promo_label
        ? { label: t.promo_label, link: t.promo_link || null }
        : null,
  };
}

router.get('/tickets/:token', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);

  const arrival = ticket.status === 'arrived' ? await lastArrivalAt(ticket.id) : null;
  res.json(guestView(
    ticket,
    await handedOver(ticket, arrival),
    arrival?.created_at ?? null
  ));
});

/**
 * The device a card lookup came from, as the hash we store -- or null.
 *
 * The guest page mints a random id once per browser and sends it as
 * X-Valet-Device. It proves nothing about who is holding the phone; what it
 * gives us is "the same browser as last time", which is all binding needs.
 * Shape-checked so an arbitrary header value cannot become a stored key, and
 * hashed so a database read is not enough to replay it.
 */
const DEVICE_ID = /^[A-Za-z0-9-]{16,128}$/;

function deviceHash(req) {
  const raw = String(req.get('x-valet-device') || '').trim();
  if (!DEVICE_ID.test(raw)) return null;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Resolves a printed card to its ticket. Venue-scoped, and that is not
 * optional.
 *
 * Card codes are unique per venue, never globally — two properties can both
 * own an "A001" without coordinating, and they will, because a box of cards
 * starts at A001 everywhere. A lookup on the bare code would match whichever
 * venue the database returned first, and a guest could be shown a stranger's
 * vehicle at a property they have never visited. So the card's QR carries the
 * venue and the lookup is scoped to it.
 *
 * The session token goes only to the device the card is bound to (072). Card
 * codes are sequential and printed, so "knows the code" is not a credential:
 * this used to hand the token -- and with it the right to summon the car -- to
 * anyone who typed A002 after A001. The first browser to scan while a ticket
 * is on the card now owns it; every other one is told the card is open
 * elsewhere and pointed at the claim code, which only the real guest was given.
 */
router.get('/cards/:communityId/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  const communityId = String(req.params.communityId || '').trim();
  if (!code || !UUID.test(communityId)) return notFound(res);

  // LEFT JOIN, not JOIN, and this is a deliberate change of behaviour.
  //
  // This used to 404 unless the card was on an open ticket, so that probing
  // codes revealed neither which were real nor which were in use. The second
  // half of that is now visible: a registered card answers whether or not a
  // car is on it.
  //
  // It is traded knowingly. The guard scans the card to *start* intake and
  // shows it to the guest straight away -- plate, make and four condition
  // photos still to come -- so "no ticket yet" is the normal case in this
  // flow, not an error. Refusing to answer would send the guest who scanned
  // promptly to a dead end. What is disclosed is that a card code is
  // registered stock at a venue, to someone already holding the card.
  const row = await queryOne(
    `SELECT c.wa_ref, t.id AS ticket_id, t.session_token, t.status,
            t.card_device_hash, cm.name AS community_name
       FROM valet_cards c
       JOIN communities cm ON cm.id = c.community_id
       LEFT JOIN valet_tickets t
         ON t.card_id = c.id
        AND t.status NOT IN ('final_closed', 'expired')
      WHERE c.community_id = $1 AND UPPER(c.code) = UPPER($2) AND c.is_active = true
      LIMIT 1`,
    [communityId, code]
  );
  if (!row) return notFound(res);

  // The venue's name, because this is the first screen a guest sees after
  // scanning and it said only "Your car is with us" over a code. They are
  // standing in the place; naming it discloses nothing they cannot see.
  const venueName = row.community_name ?? null;

  // No car on the card: nothing to protect yet, and the guest who scanned
  // before intake finished needs the WhatsApp reference to get the welcome.
  if (!row.ticket_id) {
    return res.json({ waRef: row.wa_ref, sessionToken: null, venueName, status: null, locked: false });
  }

  const mine = deviceHash(req);
  let bound = row.card_device_hash ?? null;

  if (!bound && mine) {
    // Conditional on still being unbound, so two phones scanning in the same
    // instant cannot both win: one UPDATE matches, the other matches nothing.
    // Re-read rather than trusting our own write, because the loser needs to
    // learn whose hash got there first.
    await query(
      `UPDATE valet_tickets SET card_device_hash = $2, card_bound_at = NOW()
        WHERE id = $1 AND card_device_hash IS NULL`,
      [row.ticket_id, mine]
    );
    const after = await queryOne(
      'SELECT card_device_hash FROM valet_tickets WHERE id = $1',
      [row.ticket_id]
    );
    bound = after?.card_device_hash ?? null;
  }

  if (mine && bound === mine) {
    return res.json({
      waRef: row.wa_ref,
      sessionToken: row.session_token,
      venueName,
      status: row.status,
      locked: false,
    });
  }

  // Someone else's phone, or a browser that sent no id. No waRef either:
  // messaging it binds the sender's number to whatever ticket is on the card
  // (webhooks.js), which would be the same takeover by another door.
  res.json({ sessionToken: null, locked: true, venueName, status: row.status });
});

/**
 * Resolves a claim code the guest typed.
 *
 * Globally unique among open tickets, unlike a card code, because this is all
 * the guest has: they arrive at /valet with six characters and no idea which
 * venue owns them.
 *
 * An unknown code and a closed ticket return the identical 404, so the space
 * cannot be probed for which codes are live.
 */
router.get('/claim/:code', async (req, res) => {
  const code = normalizeClaimCode(req.params.code);
  if (code.length < 4) return notFound(res);

  const row = await queryOne(
    `SELECT t.session_token, c.name AS community_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
      WHERE t.claim_code = $1 AND t.status NOT IN ('final_closed', 'expired')
      LIMIT 1`,
    [code]
  );
  if (!row) return notFound(res);

  res.json({ sessionToken: row.session_token, venueName: row.community_name ?? null });
});

router.post('/tickets/:token/request', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (!['parked', 'parked_again'].includes(ticket.status)) {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  await query(`UPDATE valet_tickets SET status = 'retrieval_requested' WHERE id = $1`, [ticket.id]);
  await logEvent(ticket.id, 'requested');

  const updated = await findTicket(req.params.token);
  emitTicketUpdate(updated);
  res.json(guestView(updated));
});

/**
 * Issues a fresh rotating QR on each call. Only the most recently issued
 * token will validate at the guard's scanner, so a screenshot of a prior one
 * cannot be replayed.
 */
/**
 * The venue's logo for the thank-you screen.
 *
 * Addressed by session token like the guard badge photo, not by community id:
 * guestView deliberately leaks no internal identifier, and adding one here to
 * save a lookup would undo that for a picture.
 */
router.get('/tickets/:token/venue-logo', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (!ticket.venue_logo_key) return res.status(404).json({ error: 'no_logo' });

  const stream = await storage.getStream(ticket.venue_logo_key);
  if (!stream) return res.status(404).json({ error: 'no_logo' });

  res.setHeader('Cache-Control', 'public, max-age=3600');
  stream.pipe(res);
});

/**
 * What the banner produced.
 *
 * Once per valet ticket, enforced by a unique index rather than by the client
 * remembering. The guest page polls every few seconds and reopens on every tap
 * of the WhatsApp link, so counting raw impressions would turn one guest on a
 * slow connection into forty -- and that is not a number anybody could charge
 * for honestly.
 */
/**
 * A promotion's banner image.
 *
 * Addressed by promotion id rather than session token, unlike the venue logo.
 * The id is already in the payload the guest page holds, the image is the same
 * public banner for every guest, and requiring a token would stop it being
 * cached across the hundreds of guests who see it in an evening.
 */
router.get('/promotions/:id/image', async (req, res) => {
  // Checked before the query: the column is a uuid, and Postgres rejects a
  // malformed one with an error rather than no rows, which surfaced as a 500
  // for any mistyped or probed URL.
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'no_image' });

  const promo = await queryOne(
    `SELECT image_key FROM valet_promotions WHERE id = $1 AND status = 'live'`,
    [req.params.id]
  );
  if (!promo?.image_key) return res.status(404).json({ error: 'no_image' });

  const stream = await storage.getStream(promo.image_key);
  if (!stream) return res.status(404).json({ error: 'no_image' });

  res.setHeader('Cache-Control', 'public, max-age=3600');
  stream.pipe(res);
});

router.post('/tickets/:token/promo/:promoId/:kind', async (req, res) => {
  const kind = String(req.params.kind);
  if (!['view', 'tap'].includes(kind)) return notFound(res);

  const ticket = await queryOne(
    'SELECT id FROM valet_tickets WHERE session_token = $1',
    [req.params.token]
  );
  if (!ticket) return notFound(res);

  await queryOne(
    `INSERT INTO valet_promotion_events (promotion_id, ticket_id, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [req.params.promoId, ticket.id, kind]
  ).catch(() => null);

  // Always 200. A guest's page must never show an error because an analytics
  // row could not be written.
  res.json({ ok: true });
});

router.get('/tickets/:token/rotating-qr', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'arrived') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  const token = newRotatingToken();
  const row = await queryOne(
    `INSERT INTO valet_rotating_tokens (ticket_id, token, expires_at)
     VALUES ($1, $2, NOW() + $3::interval) RETURNING expires_at`,
    [ticket.id, token, `${ROTATING_TTL_SECONDS} seconds`]
  );

  res.json({
    qrDataUrl: await toDataUrl(token),
    expiresAt: row.expires_at,
    ttlSeconds: ROTATING_TTL_SECONDS,
  });
});

// --- staff badge -----------------------------------------------------------
// Lets a guest confirm a valet's identity, at drop-off ("dropoff") and again
// at pickup ("current"). Deliberately NOT a general guard lookup: it only
// resolves a guard already recorded on this specific ticket, so a guest can
// never browse the staff roster, only verify the person in front of them.

function badgeGuardId(ticket, which) {
  if (which === 'dropoff') return ticket.created_by_guard_id;
  if (which === 'current') return ticket.current_guard_id;
  return null;
}

router.get('/tickets/:token/guard-badge/:which', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);

  const guardId = badgeGuardId(ticket, req.params.which);
  if (!guardId) return res.status(404).json({ error: 'no_guard' });

  const guard = await queryOne(
    'SELECT name, employee_code, badge_photo_key FROM residents WHERE id = $1',
    [guardId]
  );
  // A guard who has not set a badge up yet is an expected state, not an
  // error — the client shows a plain "not set up yet" message.
  if (!guard?.employee_code) return res.status(404).json({ error: 'no_badge' });

  res.json({ name: guard.name, employeeCode: guard.employee_code, hasPhoto: !!guard.badge_photo_key });
});

router.get('/tickets/:token/guard-badge/:which/photo', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);

  const guardId = badgeGuardId(ticket, req.params.which);
  if (!guardId) return res.status(404).json({ error: 'no_guard' });

  const guard = await queryOne('SELECT badge_photo_key FROM residents WHERE id = $1', [guardId]);
  if (!guard?.badge_photo_key) return res.status(404).json({ error: 'no_photo' });

  const stream = await storage.getStream(guard.badge_photo_key);
  if (!stream) return res.status(404).json({ error: 'no_photo' });
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

/** How long after the close a guest may still take up the discount. */
const DISCOUNT_OPTIN_WINDOW_MS = Number(process.env.DISCOUNT_OPTIN_WINDOW_HOURS || 24) * 3600000;

function existingDiscount(ticketId) {
  return queryOne(
    'SELECT code, expiry FROM valet_discount_optins WHERE ticket_id = $1 ORDER BY issued_at LIMIT 1',
    [ticketId]
  );
}

/**
 * Marketing contact, a separate DPDP collection purpose from the vehicle
 * handover photo, so it carries its own consent timestamp on its own table.
 * If the guest never taps this, no phone number is ever requested or stored.
 */
router.post('/tickets/:token/discount-optin', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  // Offered from the handover, not from the formal close. The guard still has
  // to photograph the car after scanning, and a guest asked for their number
  // while the valet walks round the bonnet is a guest still holding the phone.
  if (ticket.status !== 'final_closed' && !(await handedOver(ticket))) {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  // A window after the close, not forever. The thank-you page is reachable by
  // its link for as long as the token resolves, and an offer that could be
  // claimed weeks later is a code generator rather than a thank-you.
  if (ticket.status === 'final_closed' && ticket.closed_at
      && Date.now() - new Date(ticket.closed_at).getTime() > DISCOUNT_OPTIN_WINDOW_MS) {
    return res.status(410).json({ error: 'offer_expired', message: 'This offer has expired.' });
  }

  const phoneNumber = String(req.body.phoneNumber || '').replace(/\s+/g, '');
  if (!/^(\+91)?[6-9]\d{9}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid 10-digit mobile number' });
  }

  // One code per ticket. This used to mint a fresh code on every tap, so a
  // single stay could print as many as anyone cared to ask for. A second
  // request gets the code already issued -- a retry on a flaky connection is
  // the common case, and telling that guest "no" would read as a failure.
  const existing = await existingDiscount(ticket.id);
  if (existing) return res.status(200).json({ code: existing.code, expiry: existing.expiry });

  let issued;
  try {
    issued = await issueDiscountCode({
      phoneNumber,
      communityId: ticket.community_id,
      ticketId: ticket.id,
      consentAt: new Date().toISOString(),
    });
  } catch (err) {
    // Two taps racing past the check above: the unique index in 072 fails
    // the loser's insert. Whichever row won is the answer for both.
    const winner = await existingDiscount(ticket.id);
    if (winner) return res.status(200).json({ code: winner.code, expiry: winner.expiry });
    throw err;
  }
  const { code, expiry } = issued;

  await logEvent(ticket.id, 'discount_optin', { metadata: { code } });
  res.status(201).json({ code, expiry });
});

export default router;

/**
 * One tap of sentiment, at the end of a trip.
 *
 * Deliberately chips and no free text. A rollup counts chips; prose has to be
 * read, and nobody reads it. Anything a guest needs to say at length is a
 * conversation with the venue, not a widget.
 */
const FEEDBACK_REASONS = ['wrong_vehicle', 'long_wait', 'damage', 'staff_conduct'];

router.post('/tickets/:token/feedback', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'final_closed') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  const satisfied = req.body.satisfied === true;
  const reasons = satisfied ? [] : (Array.isArray(req.body.reasons) ? req.body.reasons : []);

  // Checked against a known list, not stored as given. One typo in a client
  // and a category exists in the rollup that nobody can read or remove.
  const unknown = reasons.filter((r) => !FEEDBACK_REASONS.includes(r));
  if (unknown.length) {
    return res.status(400).json({ error: 'unknown_reason', message: `Unrecognised: ${unknown.join(', ')}` });
  }

  try {
    await query(
      `INSERT INTO valet_feedback (ticket_id, community_id, satisfied, reasons)
       VALUES ($1, $2, $3, $4)`,
      [ticket.id, ticket.community_id, satisfied, reasons]
    );
  } catch (err) {
    // 23505: the UNIQUE on ticket_id caught a second tap. The guest is on a
    // flaky connection, not making a second point — telling them it failed
    // would only invite a third tap.
    if (err?.code !== '23505') throw err;
    return res.status(200).json({ recorded: true, duplicate: true });
  }

  res.status(201).json({ recorded: true });
});
