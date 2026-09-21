import { asyncRouter } from '../lib/async-router.js';
import multer from 'multer';
import { z } from 'zod';
import pool, { query, queryOne, queryRows } from '../db.js';
import { newSessionToken, nextDisplayId } from '../lib/tokens.js';
import { normalizePlate } from '../lib/plate.js';
import { normalizePhone } from '../lib/phone.js';
import { newClaimCode } from '../lib/claim-code.js';
import { toDataUrl } from '../lib/qr.js';
import { logEvent } from '../lib/events.js';
import { schedulePhotoDeletion, scheduleConditionMediaDeletion } from '../lib/expiry.js';
import { storage, buildKey, extensionFor } from '../lib/storage.js';
import { emitTicketUpdate } from '../lib/realtime.js';
import { lastArrivalAt, usedTokenSince } from '../lib/handover.js';
import { sendClaimCode } from '../lib/sms.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import { readPlate } from '../lib/anpr.js';
import { matchAttendant } from '../lib/face.js';
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
    `SELECT t.*, c.name AS community_name,
            cg.name AS created_guard_name, ug.name AS current_guard_name,
            s.floor AS slot_floor, s.zone AS slot_zone, s.number AS slot_number
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
       LEFT JOIN valet_slots s ON s.id = t.slot_id
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
    claimCode: t.claim_code ?? null,
    // Where the car actually is, so the queue can weigh the walk.
    slot: t.slot_floor ? { floor: t.slot_floor, zone: t.slot_zone, number: t.slot_number } : null,
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

/** Open statuses: a car standing in a slot, by any of the names that means. */
const HOLDING_A_SLOT = ['parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again'];

/**
 * Free slots, grouped the way the attendant picks them: floor, then zone.
 *
 * `enabled: false` is not the same answer as an empty list. One tells the app
 * to hide the step entirely; the other says the garage is full, which is a
 * thing the attendant has to act on.
 */
router.get('/slots', guard, async (req, res) => {
  const flag = await queryOne(
    `SELECT (config->>'valetSlotsEnabled')::boolean AS slots_enabled
       FROM communities WHERE id = $1`,
    [req.user.community_id]
  );
  if (!flag?.slots_enabled) return res.json({ enabled: false, floors: [] });

  const rows = await queryRows(
    `SELECT s.id, s.floor, s.zone, s.number
       FROM valet_slots s
       LEFT JOIN valet_tickets t
         ON t.slot_id = s.id AND t.status = ANY($2)
      WHERE s.community_id = $1 AND s.is_active = true AND t.id IS NULL
      ORDER BY s.floor, s.zone, s.number`,
    [req.user.community_id, HOLDING_A_SLOT]
  );

  const floors = [];
  for (const r of rows) {
    let floor = floors.find((f) => f.floor === r.floor);
    if (!floor) floors.push((floor = { floor: r.floor, zones: [] }));
    let zone = floor.zones.find((z) => z.zone === r.zone);
    if (!zone) floor.zones.push((zone = { zone: r.zone, slots: [] }));
    zone.slots.push({ id: r.id, number: r.number });
  }

  res.json({ enabled: true, floors });
});

/**
 * Starts a job when the guard scans the card, before any of its details exist.
 *
 * This is the state the product was missing. A ticket used to spring into
 * being already parked, so everything between "car arrives" and "guard hits
 * submit" was invisible -- including the window in which the guest scans the
 * same card and messages us.
 */
/**
 * Reads a plate off a photo, as a suggestion.
 *
 * Never submits anything. The attendant sees the reading in the field and
 * either accepts or corrects it, which is the BRD rule and the right one: a
 * plate nobody read is a plate nobody can be held to.
 *
 * A failed reading answers 200 with a null plate. Not recognising a plate is
 * the ordinary case, not an error, and a red banner in front of a guard who
 * simply needs to type it helps nobody.
 */
/**
 * Opening a shift, with a selfie.
 *
 * The BRD asks for face verification here and its reference build treats any
 * captured photo as verified. That is a fabricated result, and this does not
 * do it: the photo is stored, the shift is opened, and the response says in
 * as many words that no recognition ran. An audit trail claiming a check
 * happened is worse than one admitting it did not — and when a real service
 * is wired in, the only thing that changes is these two fields.
 *
 * A missing photo does not block the shift. A denied camera at six in the
 * morning must not be the thing that stops somebody working.
 */
router.post('/shift/start', guard, async (req, res) => {
  const scan = String(req.body.imageBase64 || '');

  // The selfie is passed to the recogniser and dropped. face_enrollments
  // holds a vector and never a photograph -- that is the whole reason it is
  // safe to hold -- and a stored selfie per shift would quietly undo it.
  let enrollment = null;
  if (scan) {
    try {
      enrollment = await queryOne(
        `SELECT vector FROM face_enrollments
          WHERE resident_id = $1 AND status = 'active' AND vector IS NOT NULL`,
        [req.user.sub]
      );
    } catch {
      // Treated as not enrolled, which is honest: we did not establish who
      // this is, and that is exactly what the response will say.
    }
  }

  const match = await matchAttendant(scan, enrollment?.vector ?? null);

  // Three distinct outcomes, kept distinct. "We could not check" is not
  // "we checked and it was not them", and an audit trail that collapses them
  // asserts something nobody verified.
  const verified = match.available ? match.verified : false;
  const reason = match.available
    ? (match.verified ? null : 'no_match')
    : (!scan ? 'no_photo'
      : !enrollment ? 'attendant_not_enrolled'
      : 'recognition_not_configured');

  try {
    await query(`UPDATE residents SET shift_started_at = NOW() WHERE id = $1`, [req.user.sub]);
  } catch {
    // Additive column; a shift is not worth failing over the bookkeeping.
  }

  // Never a lock-out. A bad light at six in the morning must not strand a
  // real attendant; the record says what happened and a manager decides.
  res.status(201).json({
    started: true,
    photo: !!scan,
    verified,
    confidence: match.available ? match.confidence : null,
    reason,
  });
});

router.post('/plate-scan', guard, async (req, res) => {
  const b64 = String(req.body.imageBase64 || '');
  if (!b64) return res.status(400).json({ error: 'image_required' });

  const suggestion = await readPlate(Buffer.from(b64, 'base64'), req.body.mimetype || 'image/jpeg');
  res.json({
    plate: suggestion?.plate ?? null,
    confidence: suggestion?.confidence ?? null,
    // Said explicitly so no client is tempted to treat it as settled.
    suggestionOnly: true,
  });
});

/**
 * Taking a job the desk logged.
 *
 * Refused unless it is still waiting: two attendants walking to the same car
 * is the failure this exists to prevent, and it is the kind that only shows up
 * on the busiest evening of the year.
 */
router.post('/tickets/:token/accept-intake', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  if (ticket.status !== 'requested') {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  await query(
    `UPDATE valet_tickets SET status = 'accepted', created_by_guard_id = $2 WHERE id = $1`,
    [ticket.id, req.user.sub]
  );
  await logEvent(ticket.id, 'accepted_for_parking', { guardId: req.user.sub });

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  res.json(ticketView(updated));
});

router.post('/tickets/start', guard, async (req, res) => {
  const communityId = req.user.community_id;
  const cardCode = String(req.body.cardCode ?? '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let card = null;
    if (cardCode) {
      const resolved = await resolveCard(client, communityId, cardCode);
      if (resolved.error) {
        await client.query('ROLLBACK');
        return cardConflict(res, resolved.error, resolved.displayId);
      }
      card = resolved.card;
    }

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('valet_display_id'), hashtext($1))`,
      [communityId]
    );
    const last = await client.query(
      `SELECT display_id FROM valet_tickets
        WHERE community_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [communityId]
    );
    const displayId = nextDisplayId(last.rows[0]?.display_id);
    const sessionToken = newSessionToken();
    const claimCode = newClaimCode();

    const inserted = await client.query(
      `INSERT INTO valet_tickets
         (community_id, display_id, session_token, claim_code, status,
          created_by_guard_id, card_id, card_code)
       VALUES ($1, $2, $3, $4, 'parking_in_progress', $5, $6, $7)
       RETURNING id`,
      [communityId, displayId, sessionToken, claimCode, req.user.sub,
       card ? card.id : null, card ? card.code : null]
    );
    const ticketId = inserted.rows[0].id;

    // A guest who scanned the card first left their number on it. The job
    // exists now, so it can hold the number directly -- and once the app
    // moves fully to this flow the card no longer needs to hold anything.
    if (card?.pending_wa_phone) {
      await client.query(
        `UPDATE valet_tickets
            SET phone_number = $2, phone_consent_at = NOW(), whatsapp_last_inbound_at = NOW()
          WHERE id = $1`,
        [ticketId, card.pending_wa_phone]
      );
      await client.query(
        `UPDATE valet_cards SET pending_wa_phone = NULL, pending_wa_at = NULL WHERE id = $1`,
        [card.id]
      );
    }

    await logEvent(ticketId, 'intake_started', { guardId: req.user.sub, client });
    await client.query('COMMIT');

    const baseUrl = process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';
    res.status(201).json({
      id: ticketId,
      displayId,
      sessionToken,
      claimCode,
      claimUrl: baseUrl,
      cardCode: card ? card.code : null,
      qrDataUrl: await toDataUrl(`${baseUrl}/w/${claimCode}`),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isCardRaceLoss(err)) return cardConflict(res, 'card_in_use');
    throw err;
  } finally {
    client.release();
  }
});

const completeIntakeSchema = z.object({
  plate: z.string().trim().min(1).max(20),
  vehicleMake: z.string().trim().min(1).max(100),
  stayEndAt: z.string().min(1),
  slotId: z.string().uuid().optional(),
  guestName: z.string().trim().max(120).optional(),
  carType: z.enum(['hatchback', 'sedan', 'suv']).optional(),
  isPremium: z.boolean().optional(),
  phoneNumber: z.string().trim().max(20).optional(),
});

/**
 * Finishes an intake: the details arrive and the car is parked.
 *
 * Only from parking_in_progress. Completing twice would overwrite a plate
 * somebody has already checked against the car in front of them.
 */
router.post('/tickets/:token/complete', guard, async (req, res) => {
  const ticket = await findTicket(req.params.token, req.user.community_id);
  if (!ticket) return notFound(res);
  // Either route in: a card scanned at the kerb (parking_in_progress) or a job
  // the desk logged and an attendant took (accepted). Insisting the second
  // pass through the first would be a transition for its own sake, with
  // somebody standing at a car waiting for it.
  if (!['parking_in_progress', 'accepted'].includes(ticket.status)) {
    return res.status(409).json({ error: 'wrong_status', status: ticket.status });
  }

  const parsed = completeIntakeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'missing_fields', message: 'plate, vehicleMake and stayEndAt are required' });
  }

  const stayEnd = new Date(parsed.data.stayEndAt);
  if (Number.isNaN(stayEnd.getTime()) || stayEnd.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'invalid_stay_end' });
  }

  const typedPhone = parsed.data.phoneNumber ? parsed.data.phoneNumber.replace(/\s+/g, '') : null;
  if (typedPhone && !/^(\+91)?[6-9]\d{9}$/.test(typedPhone)) {
    return res.status(400).json({ error: 'invalid_phone' });
  }
  // Stored with its country code, the shape WhatsApp delivers. A guard types
  // ten digits and the guest's own messages arrive with twelve; keeping both
  // shapes in one column is what made a guest unreachable from their own
  // WhatsApp. Matching still uses the last ten digits, for rows written
  // before this.
  const phoneNumber = typedPhone ? normalizePhone(typedPhone) : null;

  const plate = parsed.data.plate.toUpperCase();
  await query(
    `UPDATE valet_tickets
        SET plate = $2, plate_normalized = $3, vehicle_make = $4, stay_end_at = $5,
            slot_id = $6, guest_name = $7, car_type = $8, is_premium = $9,
            phone_number = COALESCE(phone_number, $10),
            phone_consent_at = CASE WHEN $10 IS NULL THEN phone_consent_at
                                    ELSE COALESCE(phone_consent_at, NOW()) END,
            status = 'parked'
      WHERE id = $1`,
    [ticket.id, plate, normalizePlate(plate), parsed.data.vehicleMake, stayEnd.toISOString(),
     parsed.data.slotId || null, parsed.data.guestName || null,
     parsed.data.carType || null, parsed.data.isPremium === true, phoneNumber]
  );
  await logEvent(ticket.id, 'created', {
    guardId: req.user.sub,
    metadata: { plate, vehicleMake: parsed.data.vehicleMake },
  });

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  if (updated?.phone_number) await notifyGuest(updated, 'bound');

  res.json(ticketView(updated));
});

const createTicketSchema = z.object({
  plate: z.string().trim().min(1).max(20),
  vehicleMake: z.string().trim().min(1).max(100),
  stayEndAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  // Optional: a venue with no printed card stock still works exactly as
  // before, showing the QR on the guard's screen.
  cardCode: z.string().trim().max(20).optional(),
  // Optional: the guest may decline, and a valet stand must work for a guest
  // who gives nothing but a car.
  phoneNumber: z.string().trim().max(20).optional(),
  // Optional even where slots are enabled. A full garage must never be the
  // reason a car cannot be taken in.
  slotId: z.string().uuid().optional(),

  // A plate identifies a car; a name identifies a person, and the desk often
  // needs the second. Optional -- a guest who declines still gets parked.
  guestName: z.string().trim().max(120).optional(),
  // Constrained because the entire point of the field is counting them, and
  // free text is a category nobody can count or remove.
  carType: z.enum(['hatchback', 'sedan', 'suv']).optional(),
  isPremium: z.boolean().optional(),
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
    `SELECT id, code, pending_wa_phone FROM valet_cards
      WHERE community_id = $1 AND UPPER(code) = UPPER($2) AND is_active = true`,
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

const CARD_ERROR_MESSAGE = {
  card_in_use: (displayId) =>
    displayId ? `Card is already on ticket ${displayId}` : 'That card is already on another vehicle',
  unknown_card: () => 'That card is not registered to this property',
};

function cardConflict(res, error, displayId) {
  return res.status(409).json({ error, message: CARD_ERROR_MESSAGE[error](displayId) });
}

/**
 * True when a write lost the race to the one-open-ticket-per-card index.
 *
 * resolveCard's lookup cannot prevent this on its own: two guards scanning the
 * same card at the same moment both read "free" before either inserts, and
 * with more than one service instance they are not even serialised by the
 * event loop. The index is what actually holds — this turns losing to it into
 * the same readable 409 the pre-check gives, rather than an opaque 500 that
 * tells a guard nothing about the card in their hand.
 */
function isCardRaceLoss(err) {
  return err?.code === '23505' && err?.constraint === 'idx_valet_card_one_open_ticket';
}

/** Two tickets drew the same claim code. Vanishingly rare, but not a fault. */
function isClaimCodeCollision(err) {
  return err?.code === '23505' && err?.constraint === 'idx_valet_claim_code_open';
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

  // Checked before the car is taken in, not after: a typo caught here is a
  // guard retyping a number, while the same typo caught later is a stranger
  // getting a text about someone else's car.
  const phoneNumber = parsed.data.phoneNumber
    ? parsed.data.phoneNumber.replace(/\s+/g, '')
    : null;
  if (phoneNumber && !/^(\+91)?[6-9]\d{9}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid 10-digit mobile number' });
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
        return cardConflict(res, resolved.error, resolved.displayId);
      }
      card = resolved.card;
    }

    // Serialise display-id allocation per venue.
    //
    // The row lock this replaced did not actually serialise anything. Both
    // transactions lock the SAME existing last row, so when the winner commits
    // its new row the loser resumes holding a result set computed before that
    // row existed, picks the same number, and violates
    // UNIQUE (community_id, display_id) — a 500 for a guard mid-intake. With
    // no tickets yet the lock had nothing to take at all and both picked
    // DWR-0001. An end-to-end test creating three tickets at once reproduces
    // it every run.
    //
    // An advisory lock has no such gap: it exists whether or not any row does,
    // is held to commit, and is keyed per community so two venues never wait
    // on each other. The first key namespaces it against any other advisory
    // lock in the database.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('valet_display_id'), hashtext($1))`,
      [communityId]
    );
    const last = await client.query(
      `SELECT display_id FROM valet_tickets
        WHERE community_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [communityId]
    );
    const displayId = nextDisplayId(last.rows[0]?.display_id);
    const sessionToken = newSessionToken();
    // What the guest walks away with when there is no card in their hand.
    // Issued for every ticket, not only card-less ones: a card can be bound
    // after the fact, and a code the guest already wrote down must keep
    // working. Uniqueness is enforced by the index; a collision at ~729
    // million combinations is rare enough to retry rather than design around.
    const claimCode = newClaimCode();

    // Checked inside the transaction, and only to avoid recording a slot that
    // is wrong -- never to refuse the car. A slot that has vanished or filled
    // since the attendant picked it simply is not recorded.
    let slotId = null;
    if (parsed.data.slotId) {
      const slot = await client.query(
        `SELECT s.id FROM valet_slots s
          LEFT JOIN valet_tickets t ON t.slot_id = s.id AND t.status = ANY($3)
         WHERE s.id = $1 AND s.community_id = $2 AND s.is_active = true AND t.id IS NULL`,
        [parsed.data.slotId, communityId, HOLDING_A_SLOT]
      );
      slotId = slot.rows[0]?.id || null;
    }

    const inserted = await client.query(
      `INSERT INTO valet_tickets
         (community_id, display_id, session_token, plate, plate_normalized,
          vehicle_make, stay_end_at, status, created_by_guard_id, card_id, card_code, claim_code,
          phone_number, phone_consent_at, slot_id, guest_name, car_type, is_premium)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'parked', $8, $9, $10, $11,
               $12, CASE WHEN $12 IS NULL THEN NULL ELSE NOW() END, $13, $14, $15, $16)
       RETURNING id`,
      [communityId, displayId, sessionToken, plate, normalizePlate(plate), vehicleMake, stayEnd.toISOString(), req.user.sub,
       card ? card.id : null, card ? card.code : null, claimCode, phoneNumber, slotId,
       parsed.data.guestName || null, parsed.data.carType || null, parsed.data.isPremium === true]
    );
    const ticketId = inserted.rows[0].id;

    // A guest who scanned the card while intake was still being typed left
    // their number on it. This is where the promise made to them then --
    // "we'll message you the moment it's parked" -- is kept.
    const heldPhone = card?.pending_wa_phone || null;
    if (heldPhone) {
      await client.query(
        `UPDATE valet_tickets
            SET phone_number = COALESCE(phone_number, $2),
                phone_consent_at = COALESCE(phone_consent_at, NOW()),
                whatsapp_last_inbound_at = COALESCE(whatsapp_last_inbound_at, NOW())
          WHERE id = $1`,
        [ticketId, heldPhone]
      );
      await client.query(
        `UPDATE valet_cards SET pending_wa_phone = NULL, pending_wa_at = NULL WHERE id = $1`,
        [card.id]
      );
    }

    await logEvent(ticketId, 'created', {
      guardId: req.user.sub,
      metadata: { plate, vehicleMake },
      client,
    });

    await client.query('COMMIT');

    const baseUrl = process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';
    const guestUrl = `${baseUrl}/v/${sessionToken}`;

    // The QR opens the door page, always. It offers WhatsApp first and the
    // browser second, and works whether or not the guest has WhatsApp -- which
    // a raw wa.me QR would not. The claim code printed under it is unchanged,
    // and guestUrl is still returned for the admin portal and the guard's own
    // ticket screen.
    const qrTarget = `${baseUrl}/w/${claimCode}`;

    // After COMMIT, deliberately. The car is in; a texting problem must not
    // roll back a ticket that already exists in the world. The status comes
    // back so the guard knows whether to read the code out instead.
    if (heldPhone) {
      await notifyGuest(
        {
          id: ticketId, display_id: displayId, plate, vehicle_make: vehicleMake,
          community_name: (await queryOne('SELECT name FROM communities WHERE id = $1', [communityId]))?.name,
          claim_code: claimCode, phone_number: heldPhone,
          whatsapp_last_inbound_at: new Date().toISOString(),
        },
        'bound'
      );
    }

    let smsStatus = null;
    if (phoneNumber) {
      let venueName = 'DwaarAI Valet';
      try {
        const venue = await queryOne('SELECT name FROM communities WHERE id = $1', [communityId]);
        if (venue?.name) venueName = venue.name;
      } catch {
        // The venue name is decoration on the message; failing to read it must
        // not cost the guest their code.
      }
      ({ status: smsStatus } = await sendClaimCode({ phoneNumber, claimCode, claimUrl: baseUrl, venueName }));
    }

    res.status(201).json({
      smsStatus,
      id: ticketId,
      displayId,
      sessionToken,
      guestUrl,
      cardCode: card ? card.code : null,
      claimCode,
      // Where the guest types that code. Sent by the server rather than
      // assembled in the app: the app only knows the API base, and a guessed
      // public URL is exactly the kind of thing that ships pointing at a dead
      // host.
      claimUrl: baseUrl,
      qrDataUrl: await toDataUrl(qrTarget),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isCardRaceLoss(err)) return cardConflict(res, 'card_in_use');
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
    // Matches anywhere in the plate, not just the start: a guest at the desk
    // says "the white Swift, 0435" far more often than they recite the state
    // code. A trigram index (045) serves the leading wildcard; a prefix index
    // could not.
    `SELECT t.*, cg.name AS created_guard_name, ug.name AS current_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
      WHERE t.community_id = $1
        AND t.plate_normalized LIKE '%' || $2 || '%'
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
      return cardConflict(res, resolved.error, resolved.displayId);
    }
    await client.query(
      'UPDATE valet_tickets SET card_id = $1, card_code = $2 WHERE id = $3',
      [resolved.card.id, resolved.card.code, ticket.id]
    );
    await client.query('COMMIT');
    res.json({ cardCode: resolved.card.code });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isCardRaceLoss(err)) return cardConflict(res, 'card_in_use');
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
    `SELECT t.*, cg.name AS created_guard_name, ug.name AS current_guard_name,
            s.floor AS slot_floor, s.zone AS slot_zone, s.number AS slot_number
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
       LEFT JOIN residents ug ON ug.id = t.current_guard_id
       LEFT JOIN valet_slots s ON s.id = t.slot_id
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
  if (ticket.status !== 'retrieval_requested') {
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
  // After the response is decided and never able to fail it: the car is
  // already moving whether or not the message lands.
  if (updated?.phone_number) await notifyGuest(updated, 'en_route');
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
  if (updated?.phone_number) await notifyGuest(updated, 'arrived');
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

  // Shares its definition of "since this arrival" with the guest view, which
  // shows the thank-you screen off the same scan.
  const lastArrival = await lastArrivalAt(ticket.id);
  const verifiedScan = lastArrival ? await usedTokenSince(ticket.id, lastArrival.created_at) : null;
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

  // How the guard established the person is the right one, recorded rather
  // than assumed.
  //
  // The scan above proves possession of the live ticket; it says nothing about
  // who is holding it. The intake photo is the second factor, and it is
  // optional — a guest may decline it under DPDP, and a denied camera must not
  // strand a car that is already parked. So a pickup can legitimately happen
  // with no photo, and the audit trail has to say which of the two it was. A
  // single 'closed_pickup' event for both cases makes a later dispute
  // unanswerable.
  const photo = await queryOne(
    'SELECT id FROM valet_photos WHERE ticket_id = $1 AND deleted_at IS NULL LIMIT 1',
    [ticket.id]
  );
  const claimed = req.body.verification;
  if (claimed && !['photo', 'vehicle_confirmed'].includes(claimed)) {
    return res.status(400).json({ error: 'invalid_verification' });
  }
  // Checked server-side because the client is the thing being audited: an app
  // that claimed a photo match on a ticket carrying no photo would write
  // exactly the record a dispute relies on being true.
  if (claimed === 'photo' && !photo) {
    return res.status(409).json({
      error: 'no_photo_to_match',
      message: 'No guest photo was captured for this ticket',
    });
  }
  const verification = claimed || (photo ? 'photo' : 'vehicle_confirmed');

  // Confirming a pickup does not close the ticket unless the guard marks it a
  // final checkout: otherwise the same URL and QR keep working for the next
  // pickup inside the stay window.
  if (req.body.final === true) {
    await query(
      `UPDATE valet_tickets SET status = 'final_closed', closed_at = NOW(), current_guard_id = NULL WHERE id = $1`,
      [ticket.id]
    );
    await logEvent(ticket.id, 'final_closed', { guardId: req.user.sub, metadata: { verification } });
    await schedulePhotoDeletion(ticket.id);
    await scheduleConditionMediaDeletion(ticket.id);
  } else {
    await query(
      `UPDATE valet_tickets SET status = 'parked_again', current_guard_id = NULL WHERE id = $1`,
      [ticket.id]
    );
    await logEvent(ticket.id, 'closed_pickup', { guardId: req.user.sub, metadata: { verification } });
  }

  const updated = await findTicket(req.params.token, req.user.community_id);
  emitTicketUpdate(updated);
  // Only a final close says goodbye. A multi-day ticket parking again is not
  // the end of anything.
  if (updated?.phone_number && updated.status === 'final_closed') {
    await notifyGuest(updated, 'closed');
  }
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
