import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne } from '../db.js';
import { newRotatingToken } from '../lib/tokens.js';
import { toDataUrl } from '../lib/qr.js';
import { logEvent } from '../lib/events.js';
import { issueDiscountCode } from '../lib/discount.js';
import { storage } from '../lib/storage.js';
import { emitTicketUpdate } from '../lib/realtime.js';

const router = asyncRouter();

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
            cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
       JOIN residents cg ON cg.id = t.created_by_guard_id
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

function guestView(t) {
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
  };
}

router.get('/tickets/:token', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  res.json(guestView(ticket));
});

router.post('/tickets/:token/request', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (!['parked', 'parked_again'].includes(ticket.status)) {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  await query(`UPDATE valet_tickets SET status = 'requested' WHERE id = $1`, [ticket.id]);
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

/**
 * Marketing contact, a separate DPDP collection purpose from the vehicle
 * handover photo, so it carries its own consent timestamp on its own table.
 * If the guest never taps this, no phone number is ever requested or stored.
 */
router.post('/tickets/:token/discount-optin', async (req, res) => {
  const ticket = await findTicket(req.params.token);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'final_closed') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  const phoneNumber = String(req.body.phoneNumber || '').replace(/\s+/g, '');
  if (!/^(\+91)?[6-9]\d{9}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid 10-digit mobile number' });
  }

  const { code, expiry } = await issueDiscountCode({
    phoneNumber,
    communityId: ticket.community_id,
    ticketId: ticket.id,
    consentAt: new Date().toISOString(),
  });

  await logEvent(ticket.id, 'discount_optin', { metadata: { code } });
  res.status(201).json({ code, expiry });
});

export default router;
