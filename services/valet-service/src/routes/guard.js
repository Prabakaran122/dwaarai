import { asyncRouter } from '../lib/async-router.js';
import multer from 'multer';
import { z } from 'zod';
import pool, { query, queryOne, queryRows } from '../db.js';
import { newSessionToken, nextDisplayId } from '../lib/tokens.js';
import { normalizePlate } from '../lib/plate.js';
import { toDataUrl } from '../lib/qr.js';
import { logEvent } from '../lib/events.js';
import { schedulePhotoDeletion, scheduleConditionMediaDeletion } from '../lib/expiry.js';
import { storage, buildKey, extensionFor } from '../lib/storage.js';
import { emitTicketUpdate } from '../lib/realtime.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = asyncRouter();

// Files are held in memory only long enough to hand to the storage driver,
// which may be S3. Limits stay as the prototype had them: a plain photo is
// capped smaller than condition media, which has to leave room for the video
// option and is uploaded over whatever connectivity the valet stand has.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const conditionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)),
});

const guard = authenticateJWT(['guard', 'admin']);

// --- helpers ---------------------------------------------------------------

/**
 * Every lookup is scoped to the caller's community as well as the token, so a
 * token leaked from one community cannot be acted on from another.
 */
function findTicket(sessionToken, communityId) {
  return queryOne(
    `SELECT t.*, cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
      WHERE t.session_token = $1 AND t.community_id = $2`,
    [sessionToken, communityId]
  );
}

function ticketView(t) {
  return {
    id: t.id,
    displayId: t.display_id,
    sessionToken: t.session_token,
    plate: t.plate,
    vehicleMake: t.vehicle_make,
    status: t.status,
    stayEndAt: t.stay_end_at,
    createdAt: t.created_at,
    closedAt: t.closed_at,
    createdGuardName: t.created_guard_name,
    currentGuardName: t.current_guard_name,
    etaMinutes: t.eta_minutes,
    enRouteStartedAt: t.en_route_started_at,
    disputed: t.disputed,
    cardCode: t.card_code ?? null,
  };
}

function notFound(res) {
  return res.status(404).json({ error: 'not_found' });
}

// --- staff badge -----------------------------------------------------------
// Company-issued badge only: photo, name, employee code. Never a government
// ID document or number — showing a real ID number to any guest who taps a
// button would be a meaningfully riskier disclosure than a photo and a code.

router.get('/profile', guard, async (req, res) => {
  const row = await queryOne(
    'SELECT name, employee_code, badge_photo_key FROM residents WHERE id = $1',
    [req.user.sub]
  );
  if (!row?.employee_code) return res.json({ hasBadge: false, name: row?.name || req.user.name });
  res.json({
    hasBadge: true,
    name: row.name,
    employeeCode: row.employee_code,
    hasPhoto: !!row.badge_photo_key,
  });
});

router.post('/profile', guard, photoUpload.single('idPhoto'), async (req, res) => {
  const employeeCode = String(req.body.employeeCode || '').trim();
  if (!employeeCode) return res.status(400).json({ error: 'employee_code_required' });
  if (req.body.consentAck !== 'true') return res.status(400).json({ error: 'consent_required' });

  const existing = await queryOne('SELECT badge_photo_key FROM residents WHERE id = $1', [req.user.sub]);

  let key = existing?.badge_photo_key || null;
  if (req.file) {
    key = buildKey('badge', req.user.sub, extensionFor(req.file.mimetype));
    await storage.put(key, req.file.buffer, req.file.mimetype);
    // Replace, don't accumulate: the old badge photo has no further purpose.
    if (existing?.badge_photo_key) await storage.delete(existing.badge_photo_key);
  }

  await query(
    `UPDATE residents SET employee_code = $1, badge_photo_key = $2, badge_consent_at = NOW() WHERE id = $3`,
    [employeeCode, key, req.user.sub]
  );

  res.json({ hasBadge: true, employeeCode, hasPhoto: !!key });
});

// --- ticket creation -------------------------------------------------------

const createTicketSchema = z.object({
  plate: z.string().trim().min(1).max(20),
  vehicleMake: z.string().trim().min(1).max(100),
  stayEndAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  // Optional: a venue with no printed card stock still works exactly as
  // before, showing the QR on the guard's screen.
  cardCode: z.string().trim().max(20).optional(),
});

/**
 * Resolves a printed card code to its row, refusing one that is already on an
 * open ticket.
 *
 * The reuse check is the whole point of physical cards: handing out a card
 * whose previous stay was never closed would silently point two guests at
 * different tickets, and the second scan would surface the first guest's car.
 * A partial unique index enforces this at the database too — this lookup only
 * exists to turn that into a readable error instead of a constraint violation.
 */
async function resolveCard(client, communityId, code) {
  const card = await client.query(
    'SELECT id, code FROM valet_cards WHERE community_id = $1 AND UPPER(code) = UPPER($2) AND is_active = true',
    [communityId, code]
  );
  if (!card.rows.length) return { error: 'unknown_card' };

  const inUse = await client.query(
    `SELECT display_id FROM valet_tickets
      WHERE card_id = $1 AND status NOT IN ('final_closed', 'expired') LIMIT 1`,
    [card.rows[0].id]
  );
  if (inUse.rows.length) {
    return { error: 'card_in_use', displayId: inUse.rows[0].display_id };
  }
  return { card: card.rows[0] };
}

router.post('/tickets', guard, async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'missing_fields', message: 'plate, vehicleMake and stayEndAt are required' });
  }
  const { vehicleMake } = parsed.data;
  const plate = parsed.data.plate.toUpperCase();

  const stayEnd = new Date(parsed.data.stayEndAt);
  if (Number.isNaN(stayEnd.getTime()) || stayEnd.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'invalid_stay_end', message: 'stayEndAt must be a valid future datetime' });
  }

  const communityId = req.user.community_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let card = null;
    if (parsed.data.cardCode) {
      const resolved = await resolveCard(client, communityId, parsed.data.cardCode);
      if (resolved.error) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: resolved.error,
          message: resolved.error === 'card_in_use'
            ? `Card is already on ticket ${resolved.displayId}`
            : 'That card is not registered to this property',
        });
      }
      card = resolved.card;
    }

    // Picking the next display id and inserting it happen on the same
    // connection inside one transaction, so two guards creating tickets at
    // the same moment cannot read the same sequence. The
    // UNIQUE (community_id, display_id) constraint is the backstop.
    const last = await client.query(
      `SELECT display_id FROM valet_tickets
        WHERE community_id = $1
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [communityId]
    );
    const displayId = nextDisplayId(last.rows[0]?.display_id);
    const sessionToken = newSessionToken();

    const inserted = await client.query(
      `INSERT INTO valet_tickets
         (community_id, display_id, session_token, plate, plate_normalized,
          vehicle_make, stay_end_at, status, created_by_guard_id, card_id, card_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'parked', $8, $9, $10)
       RETURNING id`,
      [communityId, displayId, sessionToken, plate, normalizePlate(plate), vehicleMake, stayEnd.toISOString(), req.user.sub,
       card ? card.id : null, card ? card.code : null]
    );
    const ticketId = inserted.rows[0].id;

    await logEvent(ticketId, 'created', {
      guardId: req.user.sub,
      metadata: { plate, vehicleMake },
      client,
    });

    await client.query('COMMIT');

    const baseUrl = process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';
    const guestUrl = `${baseUrl}/v/${sessionToken}`;

    res.status(201).json({
      id: ticketId,
      displayId,
      sessionToken,
      guestUrl,
      cardCode: card ? card.code : null,
      qrDataUrl: await toDataUrl(guestUrl),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

/**
 * Informational-only check surfaced while the guard is still filling in the
 * new-ticket form. Never blocks or shortcuts ticket creation; it only reports
 * what is already true about this plate at this community.
 *
 * Matching is plate-based, not guest-based: no name or phone number is
 * involved, consistent with the rest of the flow's no-PII posture.
 */
router.get('/plate-lookup', guard, async (req, res) => {
  const normalized = normalizePlate(req.query.plate);
  if (!normalized) return res.json({ isReturning: false });

  const row = await queryOne(
    `SELECT COUNT(*)::int AS visit_count, MAX(created_at) AS last_visit_at
       FROM valet_tickets WHERE community_id = $1 AND plate_normalized = $2`,
    [req.user.community_id, normalized]
  );

  if (!row || !row.visit_count) return res.json({ isReturning: false });
  res.json({ isReturning: true, visitCount: row.visit_count, lastVisitAt: row.last_visit_at });
});

/**
 * Plate search across this community's tickets.
 *
 * The queue screen filters what it already holds, which covers "find one of
 * the forty cars parked right now". This endpoint exists for the case that
 * cannot: a car whose ticket has closed, or a queue too large to hold. Prefix
 * match on the normalized plate, so spacing and case never matter and the
 * index can actually be used.
 */
router.get('/tickets/search', guard, async (req, res) => {
  const q = normalizePlate(req.query.plate);
  // Two characters matches most of a venue; make the caller be specific.
  if (q.length < 3) return res.json({ tickets: [], query: q });

  const rows = await queryRows(
    `SELECT t.*, cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
      WHERE t.community_id = $1
        AND t.plate_normalized LIKE $2 || '%'
      ORDER BY (t.status NOT IN ('final_closed','expired')) DESC, t.created_at DESC
      LIMIT 50`,
    [req.user.community_id, q]
  );

  res.json({ query: q, tickets: rows.map(ticketView) });
});

/**
 * Binds a printed card to an existing ticket, for the case where the guard
 * created the ticket first and reached for a card afterwards.
 */
router.post('/tickets/:token/card', guard, async (req, res) => {
  const code = String(req.body.cardCode || '').trim();
  if (!code) return res.status(400).json({ error: 'card_code_required' });

  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (['final_closed', 'expired'].includes(ticket.status)) {
    return res.status(409).json({ error: 'ticket_closed' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await resolveCard(client, req.user.community_id, code);
    if (resolved.error) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: resolved.error,
        message: resolved.error === 'card_in_use'
          ? `Card is already on ticket ${resolved.displayId}`
          : 'That card is not registered to this property',
      });
    }
    await client.query(
      'UPDATE valet_tickets SET card_id = $1, card_code = $2 WHERE id = $3',
      [resolved.card.id, resolved.card.code, ticket.id]
    );
    await client.query('COMMIT');
    res.json({ cardCode: resolved.card.code });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// --- guest comparison photo ------------------------------------------------

router.post('/tickets/:token/photo', guard, photoUpload.single('photo'), async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  if (req.body.consentAck !== 'true') {
    return res.status(400).json({ error: 'consent_required', message: 'Guard must acknowledge the consent notice before capture' });
  }
  if (!req.file) return res.status(400).json({ error: 'photo_required' });

  const key = buildKey('photo', ticket.id, extensionFor(req.file.mimetype));
  await storage.put(key, req.file.buffer, req.file.mimetype);

  const row = await queryOne(
    `INSERT INTO valet_photos (ticket_id, storage_key, consent_at) VALUES ($1, $2, NOW())
     RETURNING id, captured_at`,
    [ticket.id, key]
  );

  await logEvent(ticket.id, 'photo_captured', { guardId: req.user.sub });
  res.status(201).json({ photoId: row.id, capturedAt: row.captured_at });
});

router.get('/tickets/:token/photo', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const photo = await queryOne(
    `SELECT storage_key FROM valet_photos
      WHERE ticket_id = $1 AND deleted_at IS NULL
      ORDER BY captured_at DESC LIMIT 1`,
    [ticket.id]
  );
  if (!photo) return res.status(404).json({ error: 'no_photo' });

  const stream = await storage.getStream(photo.storage_key);
  if (!stream) return res.status(404).json({ error: 'no_photo' });
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

// --- vehicle condition capture ---------------------------------------------
// Storage only in this phase, no automated damage detection.
//
// STUB: a damage-flagging pass would read valet_condition_records for a ticket
// once both stages exist and compare intake against return. Nothing here
// computes that; a human reviews the comparison view below instead.

const conditionSchema = z.object({
  stage: z.enum(['intake', 'return']),
  mediaType: z.enum(['photo', 'video']),
  angle: z.enum(['front', 'back', 'left', 'right']).optional().nullable(),
});

router.post('/tickets/:token/condition', guard, conditionUpload.single('media'), async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const parsed = conditionSchema.safeParse({
    stage: req.body.stage,
    mediaType: req.body.mediaType,
    angle: req.body.angle ? String(req.body.angle).trim().toLowerCase() : undefined,
  });
  if (!parsed.success) {
    const bad = parsed.error.issues[0]?.path[0];
    const code = bad === 'stage' ? 'invalid_stage' : bad === 'mediaType' ? 'invalid_media_type' : 'invalid_angle';
    return res.status(400).json({ error: code });
  }
  if (!req.file) return res.status(400).json({ error: 'media_required' });

  const { stage, mediaType } = parsed.data;
  const angle = mediaType === 'photo' ? parsed.data.angle ?? null : null;

  const key = buildKey(`condition/${stage}`, ticket.id, extensionFor(req.file.mimetype));
  await storage.put(key, req.file.buffer, req.file.mimetype);

  const row = await queryOne(
    `INSERT INTO valet_condition_records (ticket_id, stage, media_type, angle, storage_key)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, captured_at`,
    [ticket.id, stage, mediaType, angle, key]
  );

  await logEvent(ticket.id, 'condition_captured', {
    guardId: req.user.sub,
    metadata: { stage, mediaType, angle },
  });

  res.status(201).json({ recordId: row.id, capturedAt: row.captured_at });
});

router.get('/tickets/:token/condition', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const rows = await queryRows(
    `SELECT id, stage, media_type, angle, captured_at
       FROM valet_condition_records
      WHERE ticket_id = $1 AND deleted_at IS NULL
      ORDER BY captured_at ASC`,
    [ticket.id]
  );

  const toView = (r) => ({
    id: r.id,
    stage: r.stage,
    mediaType: r.media_type,
    angle: r.angle,
    capturedAt: r.captured_at,
  });

  res.json({
    intake: rows.filter((r) => r.stage === 'intake').map(toView),
    return: rows.filter((r) => r.stage === 'return').map(toView),
    disputed: ticket.disputed,
  });
});

router.get('/tickets/:token/condition/:recordId/media', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const record = await queryOne(
    `SELECT storage_key FROM valet_condition_records
      WHERE id = $1 AND ticket_id = $2 AND deleted_at IS NULL`,
    [req.params.recordId, ticket.id]
  );
  if (!record) return notFound(res);

  const stream = await storage.getStream(record.storage_key);
  if (!stream) return notFound(res);
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

/**
 * Retains this ticket's condition media past the normal window.
 * One-directional: once flagged, a ticket stays flagged.
 */
router.post('/tickets/:token/dispute', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const row = await queryOne(
    `UPDATE valet_tickets SET disputed = TRUE, disputed_at = NOW()
      WHERE id = $1 RETURNING disputed_at`,
    [ticket.id]
  );
  await logEvent(ticket.id, 'disputed', { guardId: req.user.sub });
  res.json({ disputed: true, disputedAt: row.disputed_at });
});

// --- listing and detail ----------------------------------------------------

router.get('/tickets', guard, async (req, res) => {
  const includeClosed = req.query.all === 'true';
  const rows = await queryRows(
    `SELECT t.*, cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
      WHERE t.community_id = $1
        ${includeClosed ? '' : `AND t.status NOT IN ('final_closed', 'expired')`}
      ORDER BY t.created_at DESC`,
    [req.user.community_id]
  );
  res.json({ tickets: rows.map(ticketView) });
});

router.get('/tickets/:token', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);

  const events = await queryRows(
    `SELECT e.event_type, e.metadata, e.created_at, r.name AS guard_name
       FROM valet_ticket_events e
       LEFT JOIN residents r ON r.id = e.guard_id
      WHERE e.ticket_id = $1 ORDER BY e.created_at ASC`,
    [ticket.id]
  );
  const photo = await queryOne(
    'SELECT id FROM valet_photos WHERE ticket_id = $1 AND deleted_at IS NULL LIMIT 1',
    [ticket.id]
  );

  res.json({ ...ticketView(ticket), hasPhoto: !!photo, events });
});

// --- state transitions -----------------------------------------------------

router.post('/tickets/:token/accept', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'requested') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  // The guard's own judgment of how far the car is parked, not a tracked
  // location. Optional: skipping it just leaves the guest without a countdown.
  let etaMinutes = null;
  if (req.body.etaMinutes !== undefined && req.body.etaMinutes !== null) {
    const n = Number(req.body.etaMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      return res.status(400).json({ error: 'invalid_eta', message: 'etaMinutes must be an integer between 1 and 60' });
    }
    etaMinutes = n;
  }

  await query(
    `UPDATE valet_tickets
        SET status = 'en_route', current_guard_id = $1, eta_minutes = $2, en_route_started_at = NOW()
      WHERE id = $3`,
    [req.user.sub, etaMinutes, ticket.id]
  );
  await logEvent(ticket.id, 'accepted', {
    guardId: req.user.sub,
    metadata: etaMinutes ? { etaMinutes } : null,
  });

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  res.json(ticketView(updated));
});

router.post('/tickets/:token/arrived', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'en_route') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  await query(`UPDATE valet_tickets SET status = 'arrived' WHERE id = $1`, [ticket.id]);
  await logEvent(ticket.id, 'arrived', { guardId: req.user.sub });

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  res.json(ticketView(updated));
});

router.post('/tickets/:token/scan', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'arrived') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  const scanned = String(req.body.rotatingToken || '').trim();

  // Only the most recently issued token for this ticket can validate, so a
  // screenshot of an earlier QR (or an earlier poll response) cannot be
  // replayed. The single UPDATE also makes the consume atomic: two guards
  // scanning the same code concurrently cannot both succeed.
  const consumed = await queryOne(
    `UPDATE valet_rotating_tokens
        SET used_at = NOW()
      WHERE id = (
        SELECT id FROM valet_rotating_tokens
         WHERE ticket_id = $1 ORDER BY generated_at DESC LIMIT 1
      )
        AND token = $2
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING id`,
    [ticket.id, scanned]
  );

  if (!consumed) {
    await logEvent(ticket.id, 'scan_failed', { guardId: req.user.sub });
    return res.status(400).json({
      error: 'invalid_or_expired',
      message: 'QR expired or already used, ask the guest to let it refresh',
    });
  }

  await logEvent(ticket.id, 'scan_success', { guardId: req.user.sub });

  // STUB: no automated face matching runs. The client fetches the stored
  // photo via GET /tickets/:token/photo and a human guard compares it against
  // the person in front of them before confirming. An automated match would
  // run here and could downgrade this to "needs human review" on a
  // low-confidence result rather than a hard pass/fail.
  res.json({ success: true });
});

router.post('/tickets/:token/confirm-pickup', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'arrived') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  // The QR keeps rotating for freshness even after a successful scan, so this
  // must not require the *latest* token to be the used one. It only needs a
  // successful scan since this arrival — matched against the 'arrived' event
  // rather than a token pointer the guest's next auto-refresh may already
  // have superseded.
  const lastArrival = await queryOne(
    `SELECT created_at FROM valet_ticket_events
      WHERE ticket_id = $1 AND event_type = 'arrived'
      ORDER BY created_at DESC LIMIT 1`,
    [ticket.id]
  );

  const verifiedScan = lastArrival
    ? await queryOne(
        `SELECT id FROM valet_rotating_tokens
          WHERE ticket_id = $1 AND used_at IS NOT NULL AND generated_at >= $2 LIMIT 1`,
        [ticket.id, lastArrival.created_at]
      )
    : null;
  if (!verifiedScan) {
    return res.status(409).json({ error: 'scan_required', message: 'Scan the guest QR before confirming pickup' });
  }

  // Enforced here, not only in the UI: an empty return record defeats the
  // point of the feature. Scoped to media captured since this arrival, so an
  // older return capture from a previous pickup on the same multi-day ticket
  // does not satisfy a later one.
  const returnCapture = lastArrival
    ? await queryOne(
        `SELECT id FROM valet_condition_records
          WHERE ticket_id = $1 AND stage = 'return' AND captured_at >= $2 AND deleted_at IS NULL LIMIT 1`,
        [ticket.id, lastArrival.created_at]
      )
    : null;
  if (!returnCapture) {
    return res.status(409).json({
      error: 'return_condition_required',
      message: 'Capture at least one return condition photo or video before confirming pickup',
    });
  }

  // Confirming a pickup does not close the ticket unless the guard marks it a
  // final checkout: otherwise the same URL and QR keep working for the next
  // pickup inside the stay window.
  if (req.body.final === true) {
    await query(
      `UPDATE valet_tickets SET status = 'final_closed', closed_at = NOW(), current_guard_id = NULL WHERE id = $1`,
      [ticket.id]
    );
    await logEvent(ticket.id, 'final_closed', { guardId: req.user.sub });
    await schedulePhotoDeletion(ticket.id);
    await scheduleConditionMediaDeletion(ticket.id);
  } else {
    await query(
      `UPDATE valet_tickets SET status = 'parked_again', current_guard_id = NULL WHERE id = $1`,
      [ticket.id]
    );
    await logEvent(ticket.id, 'closed_pickup', { guardId: req.user.sub });
  }

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  res.json(ticketView(updated));
});

/** Manual override for the automatic stay-end sweep. */
router.post('/tickets/:token/expire', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (['final_closed', 'expired'].includes(ticket.status)) {
    return res.status(409).json({ error: 'already_closed', status: ticket.status });
  }

  await query(`UPDATE valet_tickets SET status = 'expired', closed_at = NOW() WHERE id = $1`, [ticket.id]);
  await logEvent(ticket.id, 'expired', { guardId: req.user.sub, metadata: { reason: 'manual_override' } });
  await schedulePhotoDeletion(ticket.id);
  await scheduleConditionMediaDeletion(ticket.id);

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  res.json(ticketView(updated));
});

export default router;
