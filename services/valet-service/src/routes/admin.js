import multer from 'multer';
import { asyncRouter } from '../lib/async-router.js';
import pool, { query, queryOne, queryRows } from '../db.js';
import { normalizePlate } from '../lib/plate.js';
import { storage, extensionFor } from '../lib/storage.js';
import { newClaimCode, normalizeClaimCode } from '../lib/claim-code.js';
import { newSessionToken, nextDisplayId } from '../lib/tokens.js';
import bcrypt from 'bcryptjs';
import { logEvent } from '../lib/events.js';
import { vectorize, isRecognitionConfigured } from '../lib/face.js';
import { authenticateJWT } from '../middleware/auth.js';
import { signMediaLink, verifyMediaLink, contentTypeFor, MEDIA_LINK_TTL_SECONDS } from '../lib/photo-link.js';
import {
  viewCostPaise, withGst, monthlyCeilingPaise, balanceFromLedger, splitSpend, quotaFor,
} from '../lib/ads.js';
import { createAdOrder, isPlaceholderMode } from '../lib/payments.js';
import { toDataUrl } from '../lib/qr.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';

const router = asyncRouter();

// Small on purpose. This is a wordmark shown above a thank-you message on a
// phone, not a hero image, and a venue uploading a 12MB print asset would make
// the guest wait on a hotel's patchy wifi for something they glance at.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const admin = authenticateJWT(['admin']);

/** A path id that Postgres will accept as a uuid, checked before it is asked. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The venue's own logo key, kept in communities.config rather than a column. */
function logoKeyOf(communityId) {
  return queryOne(
    `SELECT config->>'valetLogoKey' AS logo_key FROM communities WHERE id = $1`,
    [communityId]
  );
}

/**
 * Venue-level reporting, deliberately separate from the guard's fast-path
 * ticket screens: a guard does not touch this during a live handover, it is
 * for an operator reviewing history.
 *
 * The prototype rode on the guard cookie here because it had no operator
 * accounts. It no longer needs to — this requires a real admin token, so
 * reporting across every ticket at a community is a different permission from
 * handling one car.
 */
router.get('/plate-history', authenticateJWT(['admin']), async (req, res) => {
  const normalized = normalizePlate(req.query.plate);
  if (!normalized) return res.status(400).json({ error: 'plate_required' });

  // Plate matching survives formatting differences ("KA03NJ0435" vs
  // "KA 03 NJ 0435") because write time and lookup time both run the plate
  // through the same normalizePlate().
  const rows = await queryRows(
    `SELECT t.display_id, t.plate, t.created_at, t.closed_at, t.status, t.disputed,
            cg.name AS created_guard_name
       FROM valet_tickets t
       -- LEFT: a car the desk logged has no attendant until one accepts it
       -- (073). An inner join dropped those rows without a word.
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.community_id = $1 AND t.plate_normalized = $2
      ORDER BY t.created_at DESC`,
    [req.user.community_id, normalized]
  );

  res.json({
    plate: normalized,
    communityId: req.user.community_id,
    visitCount: rows.length,
    disputedCount: rows.filter((r) => r.disputed).length,
    visits: rows.map((r) => ({
      displayId: r.display_id,
      plateAsEntered: r.plate,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      status: r.status,
      disputed: r.disputed,
      createdGuardName: r.created_guard_name,
    })),
  });
});

/**
 * Everything that came through the valet stand over a window — the view a
 * manager actually asks for ("what came in over the last 30 days"), which
 * plate-history above cannot answer because it needs a plate up front.
 *
 * Reports on `created_at`: when the car was taken in. A stay that is still
 * open counts on the day it arrived, which is what "came in last 30 days"
 * means to the person asking.
 */
/**
 * An explicit window, when a named one will not do.
 *
 * "Last 30 days" answers how the desk has been doing. A manager who comes to
 * this page because something went wrong on a particular night needs the
 * night, and no multiple of seven contains it.
 *
 * Instants, not calendar dates: nothing in this service carries a venue
 * timezone, so parsing a bare 2026-08-20 would read it as a UTC day and hand
 * a manager in India a window shifted five and a half hours off the evening
 * they meant. The browser knows its own offset and sends the moments it
 * computed from the dates that were typed.
 *
 * Returns null unless BOTH ends parse -- half a range is a typo, and guessing
 * the other end silently answers a question nobody asked.
 */
function parseRange(query) {
  const at = (v) => {
    const t = Date.parse(String(v ?? ''));
    return Number.isNaN(t) ? null : new Date(t);
  };
  const a = at(query.from);
  const b = at(query.to);
  if (!a || !b) return null;
  // Backwards is a slip, not a request for nothing. Returned empty, the table
  // would read as "no cars that weekend" -- a different and far worse answer
  // than the dates being the wrong way round.
  const [from, to] = a <= b ? [a, b] : [b, a];
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * "Show me only the ones that went wrong."
 *
 * Deliberately not a filter on the ticket's own status column. A ticket the
 * retention sweep closed reads as `final_closed` -- indistinguishable, by that
 * column alone, from a car a person actually handed back -- and those swept
 * rows are precisely the ones this filter exists to surface. The question is
 * whether a human recorded a handover, so the predicate asks the event table.
 *
 * `qualifier` differs between the row query (aliased `t.`) and the totals
 * query (`valet_tickets.`), so the same definition serves both and the count
 * above the table cannot drift from the table.
 *
 * It must never be empty. valet_ticket_events has an `id` column of its own,
 * so a bare `e.ticket_id = id` inside the subquery binds to the SUBQUERY's id,
 * compares an event to itself, and NOT EXISTS is then true for every row --
 * the filter silently does nothing. The rows came back correct because they
 * were aliased; only the totals were wrong, so the page read "showing 14 of
 * 16" and nobody would have questioned the 16.
 */
const VISIT_STATUSES = ['returned', 'no_handover', 'parked'];

function visitStatusSql(status, qualifier) {
  if (!qualifier) throw new Error('visitStatusSql needs a table qualifier');
  const id = `${qualifier}id`;
  const handover = `EXISTS (
        SELECT 1 FROM valet_ticket_events e
         WHERE e.ticket_id = ${id}
           AND e.event_type IN ('final_closed', 'closed_pickup')
      )`;
  if (status === 'returned') return `AND ${handover}`;
  if (status === 'no_handover') return `AND NOT ${handover}`;
  // Still with the team: open on any definition the rest of the page uses.
  // with_guest is open but not with the team: the guest is driving it.
  if (status === 'parked') return `AND ${qualifier}status NOT IN ('final_closed', 'expired', 'with_guest')`;
  return '';
}

router.get('/visits', authenticateJWT(['admin']), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const range = parseRange(req.query);

  // Rejected rather than ignored. A filter the server does not understand,
  // silently dropped, returns the whole log under a heading that says it is
  // narrowed -- and the manager reads 17 rows as 2.
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !VISIT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  // Bounded so one request cannot try to serialise a year of a busy venue.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // Optional, and quietly ignored when it is not an id: the value arrives from
  // a select box, and a stale one must not take the whole log down.
  const staffId = /^[0-9a-f-]{36}$/i.test(String(req.query.staffId ?? ''))
    ? String(req.query.staffId)
    : null;

  // One window, built once and spent twice, so the totals line above the table
  // can never describe a different period from the table under it.
  //
  // Both ends are parameters. They have already been through Date.parse and
  // toISOString, so they cannot be anything but a canonical instant -- but a
  // value that reached SQL as text because today's validation happened to be
  // tight is a bug waiting for the day somebody loosens it.
  //
  // $2 is the day count or the range's start in both queries; the range's end
  // takes the first free position, which differs between them because the rows
  // query already uses $3-$5 for paging and the staff filter.
  const window = (alias, endPlaceholder) => (range
    ? {
        sql: `AND ${alias}created_at >= $2::timestamptz
              AND ${alias}created_at <  ${endPlaceholder}::timestamptz`,
        params: [range.from, range.to],
      }
    : {
        sql: `AND ${alias}created_at >= NOW() - ($2 || ' days')::interval`,
        params: [String(days)],
      });

  const rowWindow = window('t.', '$6');
  const rowStatus = visitStatusSql(status, 't.');

  const rows = await queryRows(
    `SELECT t.id, t.display_id, t.plate, t.plate_normalized, t.vehicle_make,
            t.guest_name, t.car_type, t.is_premium,
            t.status, t.created_at, t.closed_at, t.disputed,
            -- Which visit this is for this plate at this venue. The regulars
            -- are the guests worth recognising, and the same plate appearing
            -- six times down the page does not say that on its own.
            ROW_NUMBER() OVER (
              PARTITION BY t.plate_normalized ORDER BY t.created_at
            ) AS visit_number,
            cg.name AS created_guard_name,
            hg.name AS handed_out_guard_name,
            -- Why an expired ticket closed: a valet cancelling a check-in and
            -- the sweep giving up on an unfinished one both land in 'expired',
            -- and neither is a car that sat out its stay.
            CASE WHEN t.status = 'expired' THEN COALESCE((
              SELECT e.event_type FROM valet_ticket_events e
               WHERE e.ticket_id = t.id
                 AND e.event_type IN ('intake_cancelled', 'intake_abandoned')
               ORDER BY e.created_at DESC LIMIT 1), 'expired')
            END AS closed_reason,
            EXTRACT(EPOCH FROM (COALESCE(t.closed_at, NOW()) - t.created_at))::bigint AS stay_seconds
       FROM valet_tickets t
       -- LEFT: a car the desk logged has no attendant until one accepts it
       -- (073). An inner join dropped those rows without a word.
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
       -- Who released the car.
       --
       -- Not available on the ticket: current_guard_id is set when a valet
       -- accepts the retrieval and nulled again the moment the ticket closes,
       -- so every row in this list has an empty one. The durable record is the
       -- closure event, which is also the row the verification is stamped on.
       --
       -- Both closure kinds, most recent first: a multi-day guest can take the
       -- car out and bring it back, and "who brought it out" means the last
       -- time it happened, not the first.
       --
       -- LEFT, and the lateral is what keeps it cheap: an inner join would
       -- silently drop every car still parked -- the rows a manager most wants
       -- to see -- and that failure looks like missing data, not a bad join.
       LEFT JOIN LATERAL (
         SELECT r.name
           FROM valet_ticket_events e
           JOIN residents r ON r.id = e.guard_id
          WHERE e.ticket_id = t.id
            AND e.event_type IN ('final_closed', 'closed_pickup')
          ORDER BY e.created_at DESC
          LIMIT 1
       ) hg ON TRUE
      WHERE t.community_id = $1
        ${rowWindow.sql}
        ${rowStatus}
        AND ($5::uuid IS NULL OR t.created_by_guard_id = $5::uuid)
      ORDER BY t.created_at DESC
      LIMIT $3 OFFSET $4`,
    // The range's end is appended, so it is absent entirely on the day path
    // rather than sitting there as an unused null the query would still have
    // to be written around.
    [req.user.community_id, rowWindow.params[0], limit, offset, staffId,
     ...rowWindow.params.slice(1)]
  );

  const totalsWindow = window('', '$3');
  const totalsStatus = visitStatusSql(status, 'valet_tickets.');

  // Totals are computed over the whole window, not the returned page — a
  // manager reading "148 visits" while looking at 200 rows of 900 would be
  // worse than no number at all.
  const totals = await queryOne(
    `SELECT COUNT(*)::int                                   AS total_visits,
            -- Drives the data-quality banner. A ticket the sweep closed has
            -- no handover, no parking time anybody measured and no receipt
            -- the guest ever saw; counting them tells a manager how much of
            -- this log is actually evidence.
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM valet_ticket_events e
                 WHERE e.ticket_id = valet_tickets.id
                   AND e.event_type IN ('final_closed', 'closed_pickup')
              )
            )::int                                          AS with_handover,
            COUNT(DISTINCT plate_normalized)::int           AS unique_vehicles,
            COUNT(*) FILTER (WHERE disputed)::int           AS disputed_count,
            COUNT(*) FILTER (WHERE status NOT IN ('final_closed','expired'))::int AS open_count,
            -- Check-ins that never became a parked car: a valet cancelled them
            -- or the sweep gave up. Not a missing handover -- there was no car
            -- to hand over -- so the page must not count them as one.
            COUNT(*) FILTER (
              WHERE status = 'expired' AND EXISTS (
                SELECT 1 FROM valet_ticket_events e
                 WHERE e.ticket_id = valet_tickets.id
                   AND e.event_type IN ('intake_cancelled', 'intake_abandoned')
              )
            )::int                                          AS unfinished_intakes,
            COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at))), 0)::bigint AS avg_stay_seconds
       FROM valet_tickets
      WHERE community_id = $1
        ${totalsWindow.sql}
        ${totalsStatus}`,
    [req.user.community_id, ...totalsWindow.params]
  );

  res.json({
    days,
    // Echoed back so the page renders its own filter state from the answer it
    // got, not from what it believes it asked for.
    status,
    // Null unless a range is actually in force, so the page can say "last 30
    // days" or "20-22 Aug" without inferring which it is from the parameters
    // it happened to send.
    range,
    totals: {
      visits: totals?.total_visits ?? 0,
      withHandover: totals?.with_handover ?? 0,
      unfinishedIntakes: totals?.unfinished_intakes ?? 0,
      uniqueVehicles: totals?.unique_vehicles ?? 0,
      // A vehicle seen more than once in the window. The interesting number
      // for a venue is repeat custom, not raw footfall.
      returningVehicles: Math.max(0, (totals?.total_visits ?? 0) - (totals?.unique_vehicles ?? 0)),
      disputed: totals?.disputed_count ?? 0,
      stillOpen: totals?.open_count ?? 0,
      avgStaySeconds: Number(totals?.avg_stay_seconds ?? 0),
    },
    visits: rows.map((r) => ({
      id: r.id,
      displayId: r.display_id,
      plate: r.plate,
      vehicleMake: r.vehicle_make,
      status: r.status,
      arrivedAt: r.created_at,
      closedAt: r.closed_at,
      staySeconds: Number(r.stay_seconds),
      disputed: r.disputed,
      takenInBy: r.created_guard_name,
      // Null while the car is still on the lot. Deliberately not coalesced to
      // a dash here: the page decides how to render "nobody yet", and a
      // string would make an open visit indistinguishable from a closed one
      // whose event went missing.
      handedOutBy: r.handed_out_guard_name ?? null,
      closedReason: r.closed_reason ?? null,
      visitNumber: Number(r.visit_number),
      // The difference between "a person handed this car back" and "the sweep
      // closed the ticket days later". Showing an auto-close timestamp in a
      // "Returned at" column as though somebody did it is the most misleading
      // thing this table could do.
      handoverRecorded: !!r.handed_out_guard_name,
    })),
    paging: { limit, offset, returned: rows.length },
  });
});

/**
 * Operational summary for the valet dashboard's header. Counts only, no PII.
 */
router.get('/summary', authenticateJWT(['admin', 'guard']), async (req, res) => {
  const rows = await queryRows(
    `SELECT status, COUNT(*)::int AS count
       FROM valet_tickets
      WHERE community_id = $1
      GROUP BY status`,
    [req.user.community_id]
  );

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const open = ['parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again']
    .reduce((sum, s) => sum + (byStatus[s] || 0), 0);

  res.json({ byStatus, open });
});

// ─────────────────────────────────────────────────────────────────────────────
// Printed card stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The venue's box of printed cards, each with the ticket it is currently on.
 *
 * Registering stock is an operator job, not a guard one: a guard scans a card
 * that already exists, and letting the intake path create unknown codes on the
 * fly would mean a mis-scan silently invents a card that matches nothing
 * printed.
 */
router.get('/cards', authenticateJWT(['admin']), async (req, res) => {
  const rows = await queryRows(
    `SELECT c.id, c.code, c.is_active, c.created_at, c.retired_reason, c.retired_at,
            t.display_id, t.plate, t.vehicle_make, t.status, t.session_token,
            t.created_at AS ticket_created_at, t.card_bound_at,
            (t.phone_number IS NOT NULL) AS has_whatsapp,
            cg.name AS handed_out_by
       FROM valet_cards c
       LEFT JOIN valet_tickets t
         ON t.card_id = c.id
        AND t.status NOT IN ('final_closed', 'expired')
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE c.community_id = $1
      ORDER BY c.code`,
    [req.user.community_id]
  );

  res.json({
    // What every card's QR must encode, ending in the code. Given to the page
    // rather than rebuilt there, because the venue id in it has to be this
    // venue's and the portal does not always hold it (a venue admin's token
    // carries it; localStorage only does for a super admin).
    cardUrlBase: cardUrlBase(req.user.community_id),
    cards: rows.map((r) => ({
      id: r.id,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      // Null for an active card, and for one retired before 075 recorded why.
      retiredReason: r.retired_reason ?? null,
      retiredAt: r.retired_at ?? null,
      state: cardState(r),
      // Null means the card is in the stack, ready to hand out.
      inUseBy: r.display_id
        ? {
            displayId: r.display_id, plate: r.plate, vehicleMake: r.vehicle_make ?? null,
            status: r.status, sessionToken: r.session_token, since: r.ticket_created_at,
            scannedAt: r.card_bound_at ?? null, hasWhatsApp: !!r.has_whatsapp,
            handedOutBy: r.handed_out_by ?? null,
          }
        : null,
    })),
  });
});

/**
 * Where a card is, in the words the cards page uses.
 *
 * waiting_scan  on an open ticket, but no guest phone has opened it yet
 *               (card_bound_at, 072) -- handed out and not yet scanned
 * with_guest    on an open ticket and scanned
 * overdue       on a ticket opened more than VALET_CARD_OVERDUE_HOURS ago (24):
 *               either a long stay or a card nobody collected at handover,
 *               and either way somebody should look
 */
export function cardState(r, now = Date.now()) {
  if (!r.is_active) return 'out_of_use';
  if (!r.display_id) return 'available';
  const hours = Number(process.env.VALET_CARD_OVERDUE_HOURS) || 24;
  if (r.ticket_created_at && now - new Date(r.ticket_created_at).getTime() > hours * 3600e3) return 'overdue';
  return r.card_bound_at ? 'with_guest' : 'waiting_scan';
}

function cardUrlBase(communityId) {
  const base = process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';
  return `${base}/c/${communityId}/`;
}

/**
 * Print-ready QR codes for registered cards.
 *
 * Without this a venue had no way to make a card at all: the QR has to carry
 * the venue's id (see the card section of CLAUDE.md), and nothing in the
 * portal told anyone what it was. Only codes registered to this venue are
 * rendered -- printing a card the stand cannot scan is the failure the
 * register-first rule exists to prevent -- and the response says which asked-
 * for codes were left out, so a short sheet is never a silent one.
 */
const MAX_PRINT = 120;

router.post('/cards/qr', authenticateJWT(['admin']), async (req, res) => {
  const asked = Array.isArray(req.body?.codes)
    ? [...new Set(req.body.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
    : [];
  if (asked.length === 0) return res.status(400).json({ error: 'codes_required' });
  if (asked.length > MAX_PRINT) return res.status(400).json({ error: 'too_many', max: MAX_PRINT });

  const rows = await queryRows(
    `SELECT code FROM valet_cards
      WHERE community_id = $1 AND is_active AND UPPER(code) = ANY($2::text[])
      ORDER BY code`,
    [req.user.community_id, asked]
  );
  const base = cardUrlBase(req.user.community_id);
  const cards = await Promise.all(rows.map(async (r) => {
    const url = `${base}${encodeURIComponent(r.code)}`;
    return { code: r.code, url, qr: await toDataUrl(url) };
  }));
  const found = new Set(rows.map((r) => r.code.toUpperCase()));

  res.json({ cards, notRegistered: asked.filter((c) => !found.has(c)) });
});

async function venueCard(req) {
  return queryOne(
    'SELECT id, code FROM valet_cards WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
}

function openTicketOn(cardId) {
  return queryOne(
    `SELECT t.*, c.name AS community_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
      WHERE t.card_id = $1 AND t.status NOT IN ('final_closed', 'expired')
      LIMIT 1`,
    [cardId]
  );
}

/** The card's last ten visits, newest first: the side panel's history. */
router.get('/cards/:id/history', authenticateJWT(['admin']), async (req, res) => {
  const card = await venueCard(req);
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  const rows = await queryRows(
    `SELECT t.display_id, t.plate, t.vehicle_make, t.status, t.session_token,
            t.created_at, t.closed_at, cg.name AS handed_out_by
       FROM valet_tickets t
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.card_id = $1
      ORDER BY t.created_at DESC
      LIMIT 10`,
    [card.id]
  );
  res.json({
    uses: rows.map((r) => ({
      displayId: r.display_id, plate: r.plate, vehicleMake: r.vehicle_make,
      status: r.status, sessionToken: r.session_token,
      createdAt: r.created_at, closedAt: r.closed_at, handedOutBy: r.handed_out_by,
    })),
  });
});

/**
 * "Resend ticket to guest": the WhatsApp welcome again, for a guest who
 * deleted it or never saw it. Only possible once the guest has messaged us --
 * there is no number to send to before that, and the page says so.
 */
router.post('/cards/:id/resend', authenticateJWT(['admin']), async (req, res) => {
  const card = await venueCard(req);
  if (!card) return res.status(404).json({ error: 'card_not_found' });
  const ticket = await openTicketOn(card.id);
  if (!ticket) return res.status(409).json({ error: 'card_not_in_use', message: 'This card is not with a guest.' });
  if (!ticket.phone_number) {
    return res.status(409).json({
      error: 'no_whatsapp',
      message: 'The guest has not started a WhatsApp chat yet, so there is no number to send to.',
    });
  }

  const sent = await notifyGuest(ticket, 'bound');
  await logEvent(ticket.id, 'ticket_resent', { metadata: { by: req.user.sub, status: sent?.status } });
  if (sent?.status === 'failed') {
    return res.status(502).json({ error: 'send_failed', message: 'WhatsApp did not accept the message. Try again shortly.' });
  }
  res.json({ status: sent?.status ?? 'sent' });
});

/**
 * "Mark as returned": the card is back at the stand but its car is still with
 * us. Frees the card only -- the ticket carries on, reachable by its claim
 * code and WhatsApp -- so the card can go to the next guest.
 */
router.post('/cards/:id/return', authenticateJWT(['admin']), async (req, res) => {
  const card = await venueCard(req);
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  const freed = await queryOne(
    `UPDATE valet_tickets SET card_id = NULL, card_device_hash = NULL, card_bound_at = NULL
      WHERE card_id = $1 AND status NOT IN ('final_closed', 'expired')
      RETURNING id, display_id`,
    [card.id]
  );
  if (!freed) return res.status(409).json({ error: 'card_not_in_use', message: 'This card is already free.' });

  await logEvent(freed.id, 'card_returned', { metadata: { by: req.user.sub, card: card.code } });
  res.json({ ok: true, displayId: freed.display_id });
});

/**
 * Registers printed cards, either as an explicit list or as a range.
 *
 * A range exists because stock is printed in runs — nobody types A001..A100
 * one at a time, and making them do it guarantees gaps that only surface when
 * a guard scans a card the system has never heard of, mid-handover.
 *
 * Re-registering an existing code is not an error. Ordering another box that
 * overlaps the last one is normal, and failing the whole request over codes
 * that are already correct would leave the operator diffing lists by hand.
 */
router.post('/cards', authenticateJWT(['admin']), async (req, res) => {
  const communityId = req.user.community_id;
  let codes = [];

  if (Array.isArray(req.body.codes)) {
    codes = req.body.codes;
  } else if (req.body.prefix !== undefined || req.body.from !== undefined) {
    const prefix = String(req.body.prefix ?? '').trim().toUpperCase();
    const from = Number(req.body.from);
    const to = Number(req.body.to);
    const width = Number(req.body.width ?? 3);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return res.status(400).json({ error: 'invalid_range', message: 'from and to must be whole numbers, with to no smaller than from' });
    }
    // A slip in the range field should not mint ten thousand cards nobody
    // printed; a venue's whole stock is tens, not thousands.
    if (to - from + 1 > 500) {
      return res.status(400).json({ error: 'range_too_large', message: 'Register at most 500 cards at once' });
    }
    if (!Number.isInteger(width) || width < 1 || width > 6) {
      return res.status(400).json({ error: 'invalid_width', message: 'width must be between 1 and 6' });
    }
    for (let n = from; n <= to; n += 1) {
      codes.push(`${prefix}${String(n).padStart(width, '0')}`);
    }
  } else {
    return res.status(400).json({ error: 'codes_required', message: 'Provide codes, or a prefix with from and to' });
  }

  const cleaned = [...new Set(
    codes.map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean)
  )];
  if (!cleaned.length) return res.status(400).json({ error: 'codes_required' });
  if (cleaned.some((c) => c.length > 20)) {
    return res.status(400).json({ error: 'code_too_long', message: 'A card code is at most 20 characters' });
  }
  if (cleaned.length > 500) {
    return res.status(400).json({ error: 'range_too_large', message: 'Register at most 500 cards at once' });
  }

  const existing = await queryRows(
    'SELECT code FROM valet_cards WHERE community_id = $1 AND code = ANY($2)',
    [communityId, cleaned]
  );
  const already = new Set(existing.map((r) => r.code));
  const toAdd = cleaned.filter((c) => !already.has(c));

  if (toAdd.length) {
    // Each card also gets a reference it can carry into WhatsApp on its own.
    // The printed code is unique per venue only -- every box starts at A001 --
    // and a WhatsApp message arrives with no venue context to disambiguate it.
    // Same confusable-free alphabet as claim codes, so it survives being read
    // aloud or retyped.
    const params = [communityId];
    const values = toAdd.map((code) => {
      params.push(code, newClaimCode());
      return `($1, $${params.length - 1}, $${params.length})`;
    }).join(',');

    await queryRows(
      `INSERT INTO valet_cards (community_id, code, wa_ref) VALUES ${values}
       ON CONFLICT (community_id, code) DO NOTHING`,
      params
    );
  }

  res.status(201).json({ added: toAdd, skipped: [...already], total: cleaned.length });
});

/**
 * Retires a card — lost, or physically destroyed.
 *
 * Deactivating rather than deleting, because the card is referenced by every
 * ticket it has ever been on and that history is the point of the audit trail.
 * A card currently on an open ticket cannot be retired: the guest is still
 * holding it, and freeing it here would let the same code be handed to someone
 * else while the first vehicle is still parked.
 */
router.post('/cards/:id/deactivate', authenticateJWT(['admin']), async (req, res) => {
  const card = await queryOne(
    'SELECT id FROM valet_cards WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  const open = await queryOne(
    `SELECT display_id FROM valet_tickets
      WHERE card_id = $1 AND status NOT IN ('final_closed', 'expired') LIMIT 1`,
    [card.id]
  );
  if (open) {
    return res.status(409).json({
      error: 'card_in_use',
      message: `Card is on ticket ${open.display_id}. Check that vehicle out first.`,
    });
  }

  // Lost or damaged (075). Optional so an older portal still works; it then
  // records no reason, which the page shows as plain "Out of use".
  const reason = req.body?.reason ?? null;
  if (reason !== null && !['lost', 'damaged'].includes(reason)) {
    return res.status(400).json({ error: 'invalid_reason' });
  }

  await queryRows(
    `UPDATE valet_cards
        SET is_active = false, retired_reason = $2, retired_at = NOW()
      WHERE id = $1`,
    [card.id, reason]
  );
  res.json({ id: card.id, isActive: false, retiredReason: reason });
});

/** Puts a retired card back into circulation — it turned up again. */
router.post('/cards/:id/activate', authenticateJWT(['admin']), async (req, res) => {
  const card = await queryOne(
    'SELECT id FROM valet_cards WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  await queryRows(
    `UPDATE valet_cards
        SET is_active = true, retired_reason = NULL, retired_at = NULL
      WHERE id = $1`,
    [card.id]
  );
  res.json({ id: card.id, isActive: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plate search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds vehicles by any part of the plate, open or closed.
 *
 * Distinct from /plate-history, which needs the whole plate and reports on one
 * vehicle across visits. This is the "guest is standing here and only knows
 * the last four digits" case, and it is why the match is a substring rather
 * than a prefix.
 */
router.get('/tickets/search', authenticateJWT(['admin']), async (req, res) => {
  const q = normalizePlate(req.query.plate);
  if (q.length < 3) return res.json({ tickets: [], query: q });

  const rows = await queryRows(
    `SELECT t.display_id, t.session_token, t.plate, t.vehicle_make, t.status,
            t.created_at, t.closed_at, t.disputed, t.card_code, t.claim_code,
            cg.name AS created_guard_name
       FROM valet_tickets t
       -- LEFT: a car the desk logged has no attendant until one accepts it
       -- (073). An inner join dropped those rows without a word.
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.community_id = $1
        -- The Vehicle log's one search box (it absorbed Find a vehicle), so
        -- it answers to what a desk is actually handed: any part of the
        -- plate, the ticket number, the card or claim code a guest holds,
        -- or the name they gave. Ticket numbers compare without the hyphen,
        -- because "0005" and "DWR0005" are what people type.
        AND (t.plate_normalized LIKE '%' || $2 || '%'
             OR REPLACE(UPPER(t.display_id), '-', '') LIKE '%' || REPLACE($2, '-', '') || '%'
             OR UPPER(t.card_code) = $2
             OR UPPER(t.claim_code) = $2
             OR t.guest_name ILIKE '%' || $3 || '%')
      ORDER BY (t.status NOT IN ('final_closed','expired')) DESC, t.created_at DESC
      LIMIT 50`,
    [req.user.community_id, q, String(req.query.plate).trim().replace(/[%_\\]/g, '\\$&')]
  );

  res.json({
    query: q,
    tickets: rows.map((r) => ({
      displayId: r.display_id,
      sessionToken: r.session_token,
      plate: r.plate,
      vehicleMake: r.vehicle_make,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      disputed: r.disputed,
      cardCode: r.card_code,
      claimCode: r.claim_code,
      createdGuardName: r.created_guard_name,
    })),
  });
});

export default router;

// --- venue branding --------------------------------------------------------

/**
 * The venue's logo, shown to the guest on the thank-you screen.
 *
 * Lives in communities.config rather than its own column: it is one optional
 * string per venue, and a venue with no logo behaves exactly as it does today
 * -- its name set in type, which is all a wordmark is anyway.
 */
router.get('/branding', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  res.json({ hasLogo: !!row?.logo_key });
});

/** The live logo, so the operator sees what a guest sees rather than a filename. */
router.get('/branding/logo', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  if (!row?.logo_key) return res.status(404).json({ error: 'no_logo' });

  const stream = await storage.getStream(row.logo_key);
  if (!stream) return res.status(404).json({ error: 'no_logo' });

  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

router.post('/branding/logo', admin, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'Choose a PNG or JPG to upload' });
  }

  const communityId = req.user.community_id;
  const key = `valet/branding/${communityId}/logo-${Date.now()}.${extensionFor(req.file.mimetype)}`;
  await storage.put(key, req.file.buffer, req.file.mimetype);

  // The previous file is removed after the new one is written and recorded, so
  // a failure part-way leaves the venue with the old logo rather than none.
  const previous = await logoKeyOf(communityId);
  await query(
    `UPDATE communities
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{valetLogoKey}', to_jsonb($2::text))
      WHERE id = $1`,
    [communityId, key]
  );
  if (previous?.logo_key) await storage.delete(previous.logo_key).catch(() => {});

  res.status(201).json({ hasLogo: true });
});

router.delete('/branding/logo', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  if (!row?.logo_key) return res.status(404).json({ error: 'no_logo' });

  await query(
    `UPDATE communities SET config = config - 'valetLogoKey' WHERE id = $1`,
    [req.user.community_id]
  );
  await storage.delete(row.logo_key).catch(() => {});

  res.json({ hasLogo: false });
});

// --- parking inventory -----------------------------------------------------

/** Open statuses: a car standing in a slot, by any of the names that means. */
const HOLDING_A_SLOT = ['parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again'];

function slotsEnabledFor(communityId) {
  return queryOne(
    `SELECT (config->>'valetSlotsEnabled')::boolean AS slots_enabled
       FROM communities WHERE id = $1`,
    [communityId]
  );
}

/**
 * The venue's Floor -> Zone -> Slot grid, with occupancy.
 *
 * Occupancy is a LEFT JOIN against live tickets, computed on every read and
 * never stored. A stored is_occupied column drifts the first time a ticket
 * closes by a path nobody remembered to update, and the grid is exactly the
 * screen where that lie would be believed.
 */
router.get('/slots', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const flag = await slotsEnabledFor(communityId);

  const rows = await queryRows(
    `SELECT s.id, s.floor, s.zone, s.number, t.display_id, t.plate, t.session_token
       FROM valet_slots s
       LEFT JOIN valet_tickets t
         ON t.slot_id = s.id AND t.status = ANY($2)
      WHERE s.community_id = $1 AND s.is_active = true
      ORDER BY s.floor, s.zone, s.number`,
    [communityId, HOLDING_A_SLOT]
  );

  res.json({
    enabled: !!flag?.slots_enabled,
    slots: rows.map((r) => ({
      id: r.id,
      floor: r.floor,
      zone: r.zone,
      number: r.number,
      occupiedBy: r.display_id
        ? { displayId: r.display_id, plate: r.plate, sessionToken: r.session_token }
        : null,
    })),
  });
});

/**
 * Adds inventory, by range or explicit list — the same shape card stock uses,
 * because a garage level is numbered in a run exactly like a box of cards and
 * typing 120 slots one at a time guarantees gaps.
 */
router.post('/slots', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const floor = String(req.body.floor ?? '').trim().toUpperCase();
  const zone = String(req.body.zone ?? '').trim().toUpperCase();
  if (!floor || !zone) {
    return res.status(400).json({ error: 'floor_and_zone_required' });
  }

  let numbers = [];
  if (Array.isArray(req.body.numbers)) {
    numbers = req.body.numbers.map((n) => String(n ?? '').trim()).filter(Boolean);
  } else {
    const from = Number(req.body.from);
    const to = Number(req.body.to);
    const width = Number(req.body.width ?? 2);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return res.status(400).json({ error: 'invalid_range' });
    }
    if (to - from + 1 > 500) return res.status(400).json({ error: 'range_too_large' });
    for (let n = from; n <= to; n += 1) numbers.push(String(n).padStart(width, '0'));
  }
  if (!numbers.length) return res.status(400).json({ error: 'numbers_required' });

  const existing = await queryRows(
    `SELECT number FROM valet_slots
      WHERE community_id = $1 AND floor = $2 AND zone = $3 AND number = ANY($4)`,
    [communityId, floor, zone, numbers]
  );
  const already = new Set(existing.map((r) => r.number));
  const toAdd = numbers.filter((n) => !already.has(n));

  if (toAdd.length) {
    const params = [communityId, floor, zone];
    const values = toAdd.map((n) => {
      params.push(n);
      return `($1, $2, $3, $${params.length})`;
    }).join(',');
    await queryRows(
      `INSERT INTO valet_slots (community_id, floor, zone, number) VALUES ${values}
       ON CONFLICT (community_id, floor, zone, number) DO NOTHING`,
      params
    );
  }

  res.status(201).json({ added: toAdd, skipped: [...already] });
});

/**
 * Retires a slot. Deactivated rather than deleted: tickets reference it and
 * that history is the point of the audit trail.
 */
router.delete('/slots/:id', admin, async (req, res) => {
  const inUse = await queryOne(
    `SELECT display_id FROM valet_tickets
      WHERE slot_id = $1 AND status = ANY($2) LIMIT 1`,
    [req.params.id, HOLDING_A_SLOT]
  );
  if (inUse) {
    return res.status(409).json({
      error: 'slot_in_use',
      message: `${inUse.display_id} is standing in this slot`,
    });
  }

  await query(
    `UPDATE valet_slots SET is_active = false WHERE id = $1 AND community_id = $2`,
    [req.params.id, req.user.community_id]
  );
  res.json({ retired: true });
});

/**
 * The per-venue switch. Kept in communities.config beside valetLogoKey rather
 * than a column, because it is one optional boolean per venue and most venues
 * will never set it.
 */
router.patch('/slots/enabled', admin, async (req, res) => {
  const enabled = req.body.enabled === true;
  await query(
    `UPDATE communities
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{valetSlotsEnabled}', to_jsonb($2::boolean))
      WHERE id = $1`,
    [req.user.community_id, enabled]
  );
  res.json({ enabled });
});

// --- feedback --------------------------------------------------------------

/**
 * Sentiment for the property, and the chips behind the unhappy half.
 *
 * A filtered aggregate over valet_feedback, computed on read like every other
 * report here — there is no rollup table to drift away from the taps that
 * produced it.
 */
router.get('/feedback', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

  const totals = await queryOne(
    `SELECT COUNT(*) FILTER (WHERE satisfied)::int      AS satisfied,
            COUNT(*) FILTER (WHERE NOT satisfied)::int  AS not_satisfied
       FROM valet_feedback
      WHERE community_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
    [communityId, String(days)]
  );

  // Unnested so a trip that cited two reasons counts against both, which is
  // what a manager reading "long wait: 4" expects it to mean.
  const reasons = await queryRows(
    `SELECT reason, COUNT(*)::int AS count
       FROM valet_feedback f, UNNEST(f.reasons) AS reason
      WHERE f.community_id = $1 AND f.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY reason
      ORDER BY count DESC`,
    [communityId, String(days)]
  );

  // "Review with staff": who to actually talk to.
  //
  // A rollup says something went wrong at this property. It does not say who
  // was standing there, and a manager cannot act on a bar chart. Grouped by
  // the attendant at HANDOVER rather than at intake, deliberately -- that is
  // the moment the guest is rating. The person who parked the car six hours
  // earlier is not who they are thinking of.
  //
  // Only attendants with rated trips appear. Somebody who has had no feedback
  // at all is not a quiet success story and must not be listed as one.
  const byStaff = await queryRows(
    `SELECT r.id                                            AS guard_id,
            r.name,
            COUNT(*)::int                                   AS rated,
            COUNT(*) FILTER (WHERE NOT f.satisfied)::int    AS unhappy,
            -- The reasons cited against this person's trips, deduplicated:
            -- the count is already above, and a manager opening a conversation
            -- needs the subject, not the arithmetic a second time.
            COALESCE(
              ARRAY(
                SELECT DISTINCT UNNEST(f2.reasons)
                  FROM valet_feedback f2
                  JOIN valet_tickets t2 ON t2.id = f2.ticket_id
                 WHERE f2.community_id = f.community_id
                   AND NOT f2.satisfied
                   AND f2.created_at >= NOW() - ($2 || ' days')::interval
                   AND EXISTS (
                     SELECT 1 FROM valet_ticket_events e2
                      WHERE e2.ticket_id = t2.id
                        AND e2.guard_id = r.id
                        AND e2.event_type IN ('final_closed', 'closed_pickup')
                   )
              ), '{}'
            )                                               AS reasons
       FROM valet_feedback f
       JOIN valet_tickets t ON t.id = f.ticket_id
       -- The last handover on the ticket. A multi-day guest can take the car
       -- out and bring it back, and the trip they rated ended with whoever
       -- handed it over the final time.
       JOIN LATERAL (
         SELECT e.guard_id
           FROM valet_ticket_events e
          WHERE e.ticket_id = t.id
            AND e.event_type IN ('final_closed', 'closed_pickup')
            AND e.guard_id IS NOT NULL
          ORDER BY e.created_at DESC
          LIMIT 1
       ) last_handover ON TRUE
       JOIN residents r ON r.id = last_handover.guard_id
      WHERE f.community_id = $1
        AND f.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY r.id, r.name, f.community_id
      ORDER BY unhappy DESC, rated DESC`,
    [communityId, String(days)]
  );

  res.json({
    days,
    satisfied: totals?.satisfied ?? 0,
    notSatisfied: totals?.not_satisfied ?? 0,
    reasons,
    byStaff: byStaff.map((r) => ({
      id: r.guard_id,
      name: r.name,
      rated: Number(r.rated),
      unhappy: Number(r.unhappy),
      reasons: r.reasons ?? [],
      // Two bad trips is a bad week; it is not a pattern, and a percentage
      // printed beside somebody's name turns one into the other. The server
      // decides this rather than the page, so an export or a second client
      // cannot quietly disagree about what counts as evidence.
      enoughToJudge: Number(r.rated) >= 5,
    })),
  });
});

// --- promotions and leads --------------------------------------------------

function promotionFor(communityId) {
  return queryOne(
    `SELECT (config->>'valetAdvertisingEnabled')::boolean AS enabled,
            config->>'valetPromoLabel' AS label,
            config->>'valetPromoLink'  AS link
       FROM communities WHERE id = $1`,
    [communityId]
  );
}

/**
 * The guest receipt's ad slot, from the venue's side.
 *
 * Visible whether or not the venue has it, which is deliberate: hiding the
 * feature entirely means only the hotels who already know to ask ever ask,
 * which throws away exactly the demand signal it exists to capture.
 */
router.get('/promotion', admin, async (req, res) => {
  const row = await promotionFor(req.user.community_id);
  res.json({
    enabled: !!row?.enabled,
    label: row?.label ?? null,
    link: row?.link ?? null,
  });
});

router.patch('/promotion', admin, async (req, res) => {
  const row = await promotionFor(req.user.community_id);

  // A venue editing its own promo copy is fine. A venue granting itself the
  // slot is a commercial decision, and the only safe place for it is outside
  // this app.
  if (!row?.enabled) {
    return res.status(403).json({
      error: 'advertising_not_enabled',
      message: 'Advertising is not enabled for this property',
    });
  }

  const label = String(req.body.label ?? '').trim().slice(0, 120);
  const link = String(req.body.link ?? '').trim();

  // Rendered on a guest's phone. A javascript: or data: URL here is a venue
  // admin handing every guest an injection.
  if (link && !/^https?:\/\//i.test(link)) {
    return res.status(400).json({ error: 'invalid_link', message: 'Use a full http(s) link' });
  }

  await query(
    `UPDATE communities
        SET config = jsonb_set(
              jsonb_set(COALESCE(config, '{}'::jsonb), '{valetPromoLabel}', to_jsonb($2::text)),
              '{valetPromoLink}', to_jsonb($3::text))
      WHERE id = $1`,
    [req.user.community_id, label, link]
  );

  res.json({ enabled: true, label, link });
});

function logLead({ communityId, source, product, body, raisedBy }) {
  return query(
    `INSERT INTO valet_leads
       (community_id, source, product, contact_name, contact_phone, contact_email, message, raised_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      communityId, source, product ?? null,
      String(body.contactName ?? '').trim().slice(0, 120) || null,
      String(body.contactPhone ?? '').trim().slice(0, 20) || null,
      String(body.contactEmail ?? '').trim().slice(0, 160) || null,
      String(body.message ?? '').trim().slice(0, 2000) || null,
      raisedBy ?? null,
    ]
  );
}

/**
 * A locked venue asking for the slot.
 *
 * Logs interest and nothing else — it does not flip the flag. That is the
 * whole point of the locked state: the ask is captured, the decision is not
 * made here.
 */
router.post('/promotion/request', admin, async (req, res) => {
  await logLead({
    communityId: req.user.community_id,
    source: 'advertising',
    body: req.body,
    raisedBy: req.user.sub,
  });
  res.status(201).json({ logged: true });
});

/** The sidebar's other-products inquiry. Same table, different source. */
router.post('/leads', admin, async (req, res) => {
  await logLead({
    communityId: req.user.community_id,
    source: 'cross_sell',
    product: String(req.body.product ?? '').trim().slice(0, 60) || null,
    body: req.body,
    raisedBy: req.user.sub,
  });
  res.status(201).json({ logged: true });
});

// --- subscription ----------------------------------------------------------

/** Included vehicles per property per month on the basic plan. */
const BASIC_MONTHLY_QUOTA = 2000;

/**
 * Plan and usage. Display only — there is no self-serve billing here, and
 * deliberately no money on this screen: a usage figure a manager can read is
 * useful, a price they cannot change is just a thing to argue about.
 *
 * The quota is per property and never pooled. A four-property group tracks
 * four separate quotas, so this counts only the caller's own community.
 */
router.get('/subscription', admin, async (req, res) => {
  const communityId = req.user.community_id;

  const plan = await queryOne(
    `SELECT COALESCE(config->>'valetPlan', 'basic') AS plan,
            config->>'valetRenewalDate' AS renewal_date
       FROM communities WHERE id = $1`,
    [communityId]
  );

  // Billing is yearly; this is a running count within the current calendar
  // month of that contract, not a monthly renewal.
  const usage = await queryOne(
    `SELECT COUNT(*)::int AS used
       FROM valet_tickets
      WHERE community_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [communityId]
  );

  const isEnterprise = plan?.plan === 'enterprise';
  res.json({
    plan: isEnterprise ? 'enterprise' : 'basic',
    quota: isEnterprise ? null : BASIC_MONTHLY_QUOTA,
    used: usage?.used ?? 0,
    renewalDate: plan?.renewal_date ?? null,
    pooled: false,
  });
});

// --- exports ---------------------------------------------------------------

/**
 * A field, made safe for a spreadsheet.
 *
 * Quoting anything containing a comma, quote or newline is not politeness: a
 * vehicle make like "Swift, Dzire" would otherwise shift every later column on
 * that row by one, and the corruption is invisible until someone reconciles a
 * month of visits by hand.
 */
function csvField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The vehicle log, as a file.
 *
 * Deliberately the same query the on-screen table runs rather than a second
 * one -- an export that disagrees with the screen it was exported from is
 * worse than no export.
 */
router.get('/visits.csv', admin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  // Read the same way the screen reads it. A manager who narrows the table to
  // one weekend and then downloads a month has been handed the wrong evidence,
  // and a CSV looks right until somebody counts it.
  const range = parseRange(req.query);
  // Same filter the screen is on. An export that silently widens what the
  // table was narrowed to is the wrong evidence, handed over confidently.
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !VISIT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  const window = range
    ? {
        sql: 'AND t.created_at >= $2::timestamptz AND t.created_at < $3::timestamptz',
        params: [range.from, range.to],
      }
    : {
        sql: "AND t.created_at >= NOW() - ($2 || ' days')::interval",
        params: [String(days)],
      };

  const rows = await queryRows(
    `SELECT t.display_id, t.plate, t.vehicle_make, t.guest_name, t.car_type, t.is_premium,
            t.status, t.created_at, t.closed_at, t.disputed,
            ROW_NUMBER() OVER (
              PARTITION BY t.plate_normalized ORDER BY t.created_at
            ) AS visit_number,
            cg.name AS created_guard_name,
            hg.name AS handed_out_guard_name,
            EXTRACT(EPOCH FROM (COALESCE(t.closed_at, NOW()) - t.created_at))::bigint AS stay_seconds
       FROM valet_tickets t
       -- LEFT: a car the desk logged has no attendant until one accepts it
       -- (073). An inner join dropped those rows without a word.
       LEFT JOIN residents cg ON cg.id = t.created_by_guard_id
       -- Same lateral as GET /visits, and it has to stay the same: the export
       -- is what gets mailed to a GM or handed to an insurer, and a CSV that
       -- disagrees with the screen it was exported from is worse than either.
       LEFT JOIN LATERAL (
         SELECT r.name
           FROM valet_ticket_events e
           JOIN residents r ON r.id = e.guard_id
          WHERE e.ticket_id = t.id
            AND e.event_type IN ('final_closed', 'closed_pickup')
          ORDER BY e.created_at DESC
          LIMIT 1
       ) hg ON TRUE
      WHERE t.community_id = $1
        ${window.sql}
        ${visitStatusSql(status, 't.')}
      ORDER BY t.created_at DESC`,
    [req.user.community_id, ...window.params]
  );

  const header = [
    'Ticket', 'Plate', 'Make', 'Visit no.', 'Guest', 'Type', 'Premium', 'Status',
    'Received at', 'Returned at', 'Parking time (minutes)',
    // Was a single 'Attendant', which stopped meaning anything the moment
    // there were two of them.
    'Received by', 'Handed over by', 'Handover recorded', 'Disputed',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.display_id, r.plate, r.vehicle_make, Number(r.visit_number), r.guest_name, r.car_type,
      r.is_premium ? 'yes' : 'no', r.status,
      r.created_at ? new Date(r.created_at).toISOString() : '',
      r.closed_at ? new Date(r.closed_at).toISOString() : '',
      Math.round((Number(r.stay_seconds) || 0) / 60),
      r.created_guard_name, r.handed_out_guard_name ?? '',
      // Auto-closed tickets carry no parking time anybody measured, and the
      // export is what gets handed to an insurer. A blank here is the honest
      // answer; a number computed from a sweep timestamp is not.
      r.handed_out_guard_name ? 'yes' : 'no',
      r.disputed ? 'yes' : 'no',
    ].map(csvField).join(','));
  }

  // Named for the window it holds rather than the day it was taken: two
  // downloads in one afternoon are otherwise two files with the same name, and
  // the one in the mail thread is then unidentifiable.
  const stamp = range
    ? `${range.from.slice(0, 10)}_${range.to.slice(0, 10)}`
    : new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vehicle-log-${stamp}.csv"`);
  res.send(lines.join('\n'));
});

// --- locations and staff ---------------------------------------------------

// 'valet' is the role most staff actually hold, and was the one the enum did
// not have. Listed first because it is the default a property wants.
const VALET_ROLES = ['valet', 'valet_manager', 'temporary_driver'];

/**
 * Every property under a client admin's account.
 *
 * Not offered to a location manager at all. They have exactly one property,
 * visible on every other screen already, and a Locations list of one is
 * furniture that implies a choice they do not have.
 */
function groupLocations(accountId) {
  // A group admin opens this to decide where to send help. A list of names and
  // addresses cannot answer that, so every row carries what the desk is doing
  // right now -- all of it derived on read, like every other report here.
  return queryRows(
    `SELECT c.id, c.name, c.address,
            COALESCE(c.config->>'valetPlan', 'basic') AS plan,
            (SELECT COUNT(*) FROM valet_tickets t
              WHERE t.community_id = c.id
                AND t.status IN ('parked','parked_again','retrieval_requested','en_route','arrived')
            )::int AS parked_now,
            -- Asked for and not yet in their hands. Everything from the tap
            -- to the handover counts, because a guest standing at the door
            -- waiting is still waiting.
            (SELECT COUNT(*) FROM valet_tickets t
              WHERE t.community_id = c.id
                AND t.status IN ('retrieval_requested','en_route','arrived')
            )::int AS waiting,
            (SELECT COUNT(*) FROM valet_shifts s
              WHERE s.community_id = c.id AND s.ended_at IS NULL
            )::int AS on_shift,
            (SELECT COUNT(*) FROM valet_tickets t
              WHERE t.community_id = c.id
                AND t.created_at >= date_trunc('month', NOW())
            )::int AS cars_this_month,
            -- Today only, and from the request to the handover: a month-long
            -- average hides the evening that went wrong, which is the one a
            -- group admin is looking for.
            (SELECT AVG(EXTRACT(EPOCH FROM (h.created_at - r.created_at)))
               FROM valet_ticket_events r
               JOIN valet_ticket_events h
                 ON h.ticket_id = r.ticket_id
                AND h.event_type IN ('closed_pickup','final_closed')
                AND h.created_at > r.created_at
               JOIN valet_tickets t ON t.id = r.ticket_id
              WHERE t.community_id = c.id
                AND r.event_type = 'requested'
                AND r.created_at >= date_trunc('day', NOW())
            ) AS avg_wait_seconds,
            EXISTS (SELECT 1 FROM valet_tickets t WHERE t.community_id = c.id) AS ever_live
       FROM communities c
      WHERE c.account_id = $1
      ORDER BY c.name`,
    [accountId]
  );
}

/** One row's worth of a property, shared by the screen and the export. */
function locationRow(l) {
  return {
    id: l.id,
    name: l.name,
    address: l.address,
    plan: l.plan,
    parkedNow: Number(l.parked_now ?? 0),
    waiting: Number(l.waiting ?? 0),
    onShift: Number(l.on_shift ?? 0),
    carsThisMonth: Number(l.cars_this_month ?? 0),
    // Null rather than 0 when nothing was handed over today: "0 min average
    // wait" reads as a desk performing perfectly, not as one with no data.
    avgWaitSeconds: l.avg_wait_seconds === null || l.avg_wait_seconds === undefined
      ? null
      : Math.round(Number(l.avg_wait_seconds)),
    // Deliberately not a sync status. Valet has no edge node -- the app talks
    // straight to this API -- so "last synced 12 minutes ago" would be a
    // number with nothing behind it. What is true and useful is whether this
    // desk has ever taken a car in.
    status: l.ever_live ? 'live' : 'setting_up',
  };
}

/** Whether this request is a group admin at all, said once. */
function groupOnly(req, res) {
  if (req.user.role !== 'client_admin' || !req.user.account_id) {
    res.status(403).json({ error: 'not_a_group', message: 'This account holds a single property' });
    return false;
  }
  return true;
}

router.get('/locations', admin, async (req, res) => {
  if (!groupOnly(req, res)) return;

  const rows = (await groupLocations(req.user.account_id)).map(locationRow);

  res.json({
    locations: rows,
    totals: {
      properties: rows.length,
      parkedNow: rows.reduce((n, r) => n + r.parkedNow, 0),
      waiting: rows.reduce((n, r) => n + r.waiting, 0),
      onShift: rows.reduce((n, r) => n + r.onShift, 0),
    },
  });
});

/**
 * The group screen, as a file.
 *
 * What a regional manager forwards after looking at the screen, so it runs the
 * same query -- an export that disagrees with the page it came from is worse
 * than no export.
 */
router.get('/locations.csv', admin, async (req, res) => {
  if (!groupOnly(req, res)) return;

  const rows = (await groupLocations(req.user.account_id)).map(locationRow);

  const header = [
    'Property', 'Address', 'Plan', 'Status', 'Parked now', 'Waiting',
    'On shift', 'Cars this month', 'Average wait today (minutes)',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.name, r.address ?? '', r.plan,
      r.status === 'live' ? 'Live' : 'Setting up',
      r.parkedNow, r.waiting, r.onShift, r.carsThisMonth,
      // Blank, never 0. "0 minutes" is a claim about how fast the desk is;
      // no handovers today is the absence of one.
      r.avgWaitSeconds === null ? '' : Math.round(r.avgWaitSeconds / 60),
    ].map(csvField).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="properties-${stamp}.csv"`);
  res.send(lines.join('\n'));
});

/**
 * The valet staff of a property: managers, and the temporary drivers brought
 * in for an event.
 *
 * One list, because surge staff are the same kind of record with a different
 * shelf life — and two lists would mean every "who is on shift" question
 * having to be asked twice and somebody remembering to.
 */
router.get('/staff', admin, async (req, res) => {
  const rows = await queryRows(
    `SELECT r.id, r.name, r.mobile, r.valet_role, r.valet_until, r.is_active,
            (fe.id IS NOT NULL) AS face_enrolled,
            open.started_at  AS shift_started_at,
            last.ended_at    AS last_ended_at
       FROM residents r
       LEFT JOIN face_enrollments fe
              ON fe.resident_id = r.id AND fe.status = 'active'
       -- The open shift, if any. NOT residents.shift_started_at: that column
       -- is overwritten on every sign-in and never cleared, so it happily
       -- reports somebody as on duty months after they went home.
       LEFT JOIN LATERAL (
         SELECT s.started_at FROM valet_shifts s
          WHERE s.resident_id = r.id AND s.ended_at IS NULL
          ORDER BY s.started_at DESC LIMIT 1
       ) open ON TRUE
       -- And when they were last seen, for the "Last out 6:04 PM" line.
       LEFT JOIN LATERAL (
         SELECT s.ended_at FROM valet_shifts s
          WHERE s.resident_id = r.id AND s.ended_at IS NOT NULL
          ORDER BY s.ended_at DESC LIMIT 1
       ) last ON TRUE
      WHERE r.community_id = $1 AND r.type = 'guard' AND r.is_active = true
      ORDER BY r.valet_role NULLS LAST, r.name`,
    [req.user.community_id]
  );

  res.json({
    staff: rows.map((r) => ({
      id: r.id,
      name: r.name,
      mobile: r.mobile,
      role: r.valet_role || 'valet',
      faceEnrolled: r.face_enrolled === true,
      until: r.valet_until,
      // A temp whose date has passed is shown as expired rather than quietly
      // dropped: somebody has to notice they are still on the list.
      expired: !!(r.valet_until && new Date(r.valet_until) < new Date()),

      onShift: !!r.shift_started_at,
      shiftStartedAt: r.shift_started_at ?? null,
      lastEndedAt: r.last_ended_at ?? null,
      // Deliberately NOT a `canStartShift` flag. The redesign assumes Face ID
      // gates sign-in ("they need it to sign in to the valet app"), but
      // /shift/start never blocks -- stranding a real attendant in bad light
      // is the worse failure, and that was a considered decision. So somebody
      // without Face ID can and does work; their shifts are simply recorded
      // unverified. `faceEnrolled` above already says this truthfully, and a
      // second field claiming they cannot work would be false on its face.
    })),
  });
});

/**
 * The shift log.
 *
 * What the Staff screen's second tab reads. Deliberately a log of shifts and
 * not an attendance product: no late marks, no overtime rules, no leave. This
 * answers "who was on duty, when, where, and had we actually verified them",
 * which is the question a valet manager has when a car goes missing at 7pm.
 */
/**
 * What a hotel wants to tell us.
 *
 * The only screen in this product where information runs the other way. A
 * venue that watches its own suggestion move from Planned to Live keeps
 * sending them, so the status and the one-line update are as much the feature
 * as the form is.
 */
const IDEA_CATEGORIES = ['not_working', 'make_better', 'our_hotel', 'something_new'];
const IDEA_IMPACTS = ['a_little', 'daily', 'a_lot'];

/**
 * The doors guests hand over and collect cars at.
 *
 * A hotel does not have "a valet desk" -- it has a main porch running all day
 * and a banquet entrance that opens for events, and an attendant works one of
 * them for a shift. Without this the shift log could not say which door
 * somebody was on, which is the first question asked when a car goes missing.
 */
const POINT_STATUSES = ['active', 'events_only', 'paused'];

/**
 * A promotion on the guest's thank-you page.
 *
 * Replaces one line of config text with a banner, a traceable offer code and
 * counts of what it produced. Pricing, ad balance, GST and the review queue
 * are deliberately absent -- those are commercial decisions and the payment
 * layer is still in placeholder mode. A venue can run a promotion and measure
 * it honestly without any of them.
 */
const PROMO_STATUSES = ['draft', 'live', 'paused', 'ended'];

/** Rendered on a guest's phone, so anything but http(s) is a script target. */
function safeUrl(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: null };
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false };
  }
}

router.get('/promotions', admin, async (req, res) => {
  const rows = await queryRows(
    `SELECT p.id, p.headline, p.body, p.image_key, p.button_label, p.button_url,
            p.offer_code, p.redeem_note, p.starts_at, p.ends_at, p.status, p.created_at,
            p.spend_limit_paise, p.show_from, p.show_to,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'view')::int   AS views,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'tap')::int    AS taps,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'redeem')::int AS redeems
       FROM valet_promotions p
      WHERE p.community_id = $1
      ORDER BY p.created_at DESC
      LIMIT 50`,
    [req.user.community_id]
  );

  res.json({
    promotions: rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      body: r.body ?? null,
      hasImage: !!r.image_key,
      buttonLabel: r.button_label ?? null,
      buttonUrl: r.button_url ?? null,
      offerCode: r.offer_code ?? null,
      redeemNote: r.redeem_note ?? null,
      startsAt: r.starts_at ?? null,
      endsAt: r.ends_at ?? null,
      spendLimitPaise: r.spend_limit_paise ?? null,
      showFrom: r.show_from ?? null,
      showTo: r.show_to ?? null,
      status: r.status,
      createdAt: r.created_at,
      // Views are one per valet ticket, not per page load: the guest page
      // polls, so raw impressions would turn one guest on a slow connection
      // into forty.
      views: Number(r.views ?? 0),
      taps: Number(r.taps ?? 0),
      redeems: Number(r.redeems ?? 0),
    })),
  });
});

/**
 * The promotion numbers, line by line.
 *
 * The design promises "every number can be checked line by line in the
 * download", and that promise is the only reason a venue should believe a
 * view count they cannot otherwise audit.
 */
router.get('/promotions.csv', admin, async (req, res) => {
  const rows = await queryRows(
    `SELECT p.headline, p.offer_code, p.status, p.starts_at, p.ends_at, p.created_at,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'view')::int   AS views,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'tap')::int    AS taps,
            (SELECT COUNT(*) FROM valet_promotion_events e
              WHERE e.promotion_id = p.id AND e.kind = 'redeem')::int AS redeems
       FROM valet_promotions p
      WHERE p.community_id = $1
      ORDER BY p.created_at DESC`,
    [req.user.community_id]
  );

  const header = [
    'Promotion', 'Offer code', 'Status', 'Starts', 'Ends', 'Created',
    'Verified views', 'Button taps', 'Offers redeemed',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.headline, r.offer_code ?? '', r.status,
      r.starts_at ? new Date(r.starts_at).toISOString() : '',
      r.ends_at ? new Date(r.ends_at).toISOString() : '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
      r.views, r.taps, r.redeems,
    ].map(csvField).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="promotions-${stamp}.csv"`);
  res.send(lines.join('\n'));
});

router.post('/promotions', admin, async (req, res) => {
  const headline = String(req.body.headline ?? '').trim().slice(0, 80);
  if (!headline) {
    return res.status(400).json({ error: 'missing_fields', message: 'Give the banner a headline' });
  }

  const url = safeUrl(req.body.buttonUrl);
  if (!url.ok) {
    return res.status(400).json({
      error: 'invalid_url',
      message: 'The button must point at an http or https address',
    });
  }

  const row = await queryOne(
    `INSERT INTO valet_promotions
       (community_id, headline, body, button_label, button_url, offer_code, redeem_note,
        starts_at, ends_at, spend_limit_paise, show_from, show_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, status`,
    [
      req.user.community_id,
      headline,
      String(req.body.body ?? '').trim().slice(0, 240) || null,
      String(req.body.buttonLabel ?? '').trim().slice(0, 40) || null,
      url.value,
      String(req.body.offerCode ?? '').trim().toUpperCase().slice(0, 24) || null,
      String(req.body.redeemNote ?? '').trim().slice(0, 240) || null,
      req.body.startsAt ? new Date(req.body.startsAt) : null,
      req.body.endsAt ? new Date(req.body.endsAt) : null,
      // A cap on delivery, not a charge. Null means "no cap", which is
      // different from zero and must stay different.
      Number.isFinite(parseInt(req.body.spendLimitPaise, 10))
        ? parseInt(req.body.spendLimitPaise, 10)
        : null,
      // Both ends or neither: half a window is a typo, and guessing the other
      // end would silently advertise at an hour nobody chose.
      req.body.showFrom && req.body.showTo ? String(req.body.showFrom) : null,
      req.body.showFrom && req.body.showTo ? String(req.body.showTo) : null,
    ]
  );

  // Always a draft. Nothing reaches a guest's screen because somebody filled
  // in a form.
  res.status(201).json({ id: row?.id, status: row?.status });
});

/**
 * The banner image.
 *
 * Same 2MB ceiling as the venue logo and for the same reason: this loads on a
 * guest's phone over a hotel's wifi, and a print asset would make them wait
 * for something they glance at.
 */
router.post('/promotions/:id/image', admin, logoUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'Choose a PNG or JPG to upload' });
  }

  const existing = await queryOne(
    'SELECT image_key FROM valet_promotions WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const key = `valet/promo/${req.user.community_id}/${req.params.id}-${Date.now()}.${extensionFor(req.file.mimetype)}`;
  await storage.put(key, req.file.buffer, req.file.mimetype);

  await query(
    'UPDATE valet_promotions SET image_key = $3, updated_at = NOW() WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id, key]
  );
  // Removed only after the new one is recorded, so a failure part-way leaves
  // the old banner rather than none.
  if (existing.image_key) await storage.delete(existing.image_key).catch(() => {});

  res.status(201).json({ hasImage: true });
});

router.patch('/promotions/:id', admin, async (req, res) => {
  const status = String(req.body.status ?? '');
  if (!PROMO_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  try {
    const row = await queryOne(
      `UPDATE valet_promotions SET status = $3, updated_at = NOW()
        WHERE id = $1 AND community_id = $2
        RETURNING id, status`,
      [req.params.id, req.user.community_id, status]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.json({ id: row.id, status: row.status });
  } catch (err) {
    // Two banners cannot share one thank-you screen. Refusing is the only
    // honest option -- letting the second win would silently take the first
    // down without telling anybody.
    if (err?.code === '23505' && err?.constraint === 'idx_valet_promotions_one_live') {
      return res.status(409).json({
        error: 'already_live',
        message: 'Another promotion is already live. Pause it first.',
      });
    }
    throw err;
  }
});

/**
 * Marking a guest's code used, from the restaurant or spa counter.
 *
 * The code a guest is shown is the promotion's stem plus their ticket's claim
 * code, which is what makes a redemption traceable to one car on one night
 * rather than to "somebody saw a poster".
 */
router.post('/promotions/:id/redeem', admin, async (req, res) => {
  const code = String(req.body.code ?? '').trim().toUpperCase();
  const claim = code.includes('-') ? code.slice(code.lastIndexOf('-') + 1) : code;
  if (!claim) return res.status(400).json({ error: 'missing_fields' });

  // The promotion has to be this property's own. The ticket lookup below was
  // scoped and this was not, so a counter at one hotel could pass another
  // venue's promotion id and file redemptions against its campaign -- the
  // numbers that venue's ad spend is judged on. Not-found and not-yours are
  // one answer, so the id of somebody else's promotion is not confirmed.
  // A malformed id is the same 404 rather than a uuid cast error and a 500.
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'not_found' });
  const promotion = await queryOne(
    'SELECT id FROM valet_promotions WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!promotion) return res.status(404).json({ error: 'not_found' });

  const ticket = await queryOne(
    `SELECT id, community_id FROM valet_tickets
      WHERE claim_code = $1 AND community_id = $2`,
    [normalizeClaimCode(claim), req.user.community_id]
  );
  if (!ticket) {
    return res.status(404).json({
      error: 'unknown_code',
      message: 'That code does not match a visit here',
    });
  }

  const row = await queryOne(
    `INSERT INTO valet_promotion_events (promotion_id, ticket_id, kind)
     VALUES ($1, $2, 'redeem')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [req.params.id, ticket.id]
  );
  if (!row) {
    // The same screenshot shown twice. The second person needs a clear answer,
    // not a silent success.
    return res.status(409).json({
      error: 'already_redeemed',
      message: 'This code has already been used',
    });
  }

  res.json({ redeemed: true });
});

/**
 * A property's own details.
 *
 * Kept in communities.config alongside the logo and plan rather than in new
 * columns: these are a handful of optional strings a venue fills in once, and
 * the JSONB pattern is already how this product stores that kind of thing.
 *
 * "Last sync" from the design is deliberately absent — valet has no edge node,
 * the app talks straight to this API, so the number would have nothing behind
 * it. Ticket type is reported rather than stored: it is what the product does,
 * not something a venue sets, and an empty field invites somebody to fill it.
 */
router.get('/property', admin, async (req, res) => {
  const row = await queryOne(
    `SELECT c.name, c.address,
            c.config->>'valetDeskPhone'  AS desk_phone,
            c.config->>'valetHours'      AS hours,
            c.config->>'valetWentLiveAt' AS went_live_at,
            -- Who to call about this property, which is the one field on the
            -- design's card that answers a question rather than stating a
            -- setting. Read rather than stored: it is already a row.
            --
            -- From the admins table, not residents. Portal logins are
            -- their own table; residents holds people who live at or work the
            -- gate of a property, and there is no type = 'admin' in it. A
            -- version of this that looked there returned null for every
            -- property while every test passed, because a mock has no opinion
            -- about which table a row is in.
            (SELECT a.name FROM admins a
              WHERE a.community_id = c.id
              ORDER BY a.created_at LIMIT 1)        AS admin_name,
            -- Cars on the lot right now. The design puts this beside "on shift
            -- now" because the pair is the whole state of a valet desk.
            (SELECT COUNT(*) FROM valet_tickets t
              WHERE t.community_id = c.id
                AND t.status NOT IN ('final_closed', 'expired'))::int AS parked_now
       FROM communities c WHERE c.id = $1`,
    [req.user.community_id]
  );
  if (!row) return res.status(404).json({ error: 'not_found' });

  res.json({
    name: row.name,
    address: row.address ?? null,
    deskPhone: row.desk_phone ?? null,
    hours: row.hours ?? null,
    wentLiveAt: row.went_live_at ?? null,
    admin: row.admin_name ?? null,
    parkedNow: Number(row.parked_now ?? 0),
    ticketType: 'Digital, via WhatsApp',
    // The number guests message. One per deployment, not per property, which
    // is why it is read from the environment and not editable here.
    guestWhatsApp: process.env.WHATSAPP_NUMBER || null,
  });
});

router.patch('/property', admin, async (req, res) => {
  const deskPhone = req.body.deskPhone === undefined
    ? undefined
    : String(req.body.deskPhone).trim();
  // Blank is a real answer — "we have not set one" — so only a non-empty value
  // that is not phone-shaped is rejected.
  if (deskPhone && !/^[0-9+()\s-]{6,20}$/.test(deskPhone)) {
    return res.status(400).json({
      error: 'invalid_phone',
      message: 'Enter a phone number guests could dial',
    });
  }

  const address = req.body.address === undefined
    ? undefined
    : String(req.body.address).trim().slice(0, 300);
  const hours = req.body.hours === undefined
    ? undefined
    : String(req.body.hours).trim().slice(0, 120);

  const row = await queryOne(
    `UPDATE communities
        SET address = COALESCE($2, address),
            config = COALESCE(config, '{}'::jsonb)
                     || CASE WHEN $3::text IS NULL THEN '{}'::jsonb
                             ELSE jsonb_build_object('valetDeskPhone', $3::text) END
                     || CASE WHEN $4::text IS NULL THEN '{}'::jsonb
                             ELSE jsonb_build_object('valetHours', $4::text) END
      WHERE id = $1
      RETURNING id`,
    [req.user.community_id, address ?? null, deskPhone ?? null, hours ?? null]
  );
  if (!row) return res.status(404).json({ error: 'not_found' });

  res.json({ saved: true });
});

router.get('/points', admin, async (req, res) => {
  const rows = await queryRows(
    `SELECT p.id, p.name, p.status, p.capacity,
            (SELECT COUNT(*) FROM valet_shifts s
              WHERE s.community_id = p.community_id
                AND s.ended_at IS NULL
                AND s.valet_point = p.name)::int AS on_shift
       FROM valet_points p
      WHERE p.community_id = $1
      ORDER BY p.status, p.name`,
    [req.user.community_id]
  );

  res.json({
    points: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      // Null, not 0. Plenty of venues genuinely do not know their capacity,
      // and a made-up number is worse than an empty one.
      capacity: r.capacity ?? null,
      onShift: Number(r.on_shift ?? 0),
    })),
  });
});

router.post('/points', admin, async (req, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'missing_fields', message: 'Give the point a name' });

  const capacity = Number.isFinite(Number(req.body.capacity)) && Number(req.body.capacity) > 0
    ? Math.floor(Number(req.body.capacity))
    : null;
  const status = POINT_STATUSES.includes(req.body.status) ? req.body.status : 'active';

  try {
    const row = await queryOne(
      `INSERT INTO valet_points (community_id, name, status, capacity)
       VALUES ($1, $2, $3, $4) RETURNING id, name`,
      [req.user.community_id, name, status, capacity]
    );
    return res.status(201).json({ id: row?.id, name: row?.name });
  } catch (err) {
    // Matched on the constraint name rather than the code alone: a 23505 here
    // can only be the one index, but saying which keeps the error readable if
    // another is ever added.
    if (err?.code === '23505' && err?.constraint === 'idx_valet_points_name') {
      return res.status(409).json({
        error: 'point_exists',
        message: 'A valet point with that name already exists here',
      });
    }
    throw err;
  }
});

/**
 * Edit a valet point: its name, its capacity, or its status.
 *
 * Took a status and nothing else until now, which meant a porch named in a
 * hurry during setup was named for good. The workaround -- pause it, add a
 * second point with the right name -- splits a door's shift history across two
 * rows that read as two doors, so the log stops being able to answer "who was
 * on the main porch last month".
 *
 * Each field is optional and absent means unchanged, so the status-only call
 * the pause button makes is untouched.
 */
router.patch('/points/:id', admin, async (req, res) => {
  const sets = [];
  const params = [req.params.id, req.user.community_id];

  if (req.body.status !== undefined) {
    const status = String(req.body.status);
    if (!POINT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
  }

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    // A blank name leaves a row the shift log renders as an empty cell, and a
    // shift against a nameless door is a shift nobody can place.
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    params.push(name.slice(0, 80));
    sets.push(`name = $${params.length}`);
  }

  if (req.body.capacity !== undefined) {
    // Null is a real answer -- "we have never counted" -- and must be settable
    // again by somebody who typed a number they were not sure of.
    const raw = req.body.capacity;
    const capacity = raw === null || raw === '' ? null : parseInt(raw, 10);
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) {
      return res.status(400).json({ error: 'invalid_capacity' });
    }
    params.push(capacity);
    sets.push(`capacity = $${params.length}`);
  }

  // Nothing to do is a client bug, not a no-op to be reported as success.
  if (sets.length === 0) return res.status(400).json({ error: 'nothing_to_change' });

  // What the point is called now, needed below to find the shift rows carrying
  // the old label. Read AFTER validation and only when a rename is actually
  // being asked for: a request that is going to be rejected must not touch the
  // database at all.
  const previous = req.body.name === undefined
    ? null
    : await queryOne(
        'SELECT name FROM valet_points WHERE id = $1 AND community_id = $2',
        [req.params.id, req.user.community_id]
      );

  // Paused, never deleted. Shifts reference the name, and a property closing a
  // door for a refurbishment still needs last month's log to make sense.
  const row = await queryOne(
    `UPDATE valet_points SET ${sets.join(', ')}
      WHERE id = $1 AND community_id = $2
      RETURNING id, name, capacity, status`,
    params
  );
  if (!row) return res.status(404).json({ error: 'not_found' });

  // valet_shifts records the point by NAME, so a rename that stopped here
  // would split one door's history in two: last month's log still says "Main
  // porch", today's screen says "Porte cochere", and the live "on shift now"
  // count against the point drops to zero the moment it is renamed. The name
  // is a label on a door that did not change, so the label moves with it.
  //
  // Scoped to the community, because two properties each have a "Main porch".
  // Done after the point update rather than before, so a rejected rename never
  // rewrites a shift log.
  if (req.body.name !== undefined && previous && previous.name !== row.name) {
    await query(
      `UPDATE valet_shifts SET valet_point = $3
        WHERE community_id = $1 AND valet_point = $2`,
      [req.user.community_id, previous.name, row.name]
    );
  }
  res.json({
    id: row.id,
    name: row.name,
    capacity: row.capacity ?? null,
    status: row.status,
  });
});

/**
 * The shift log as a file.
 *
 * Same columns as the screen. A column visible in the portal and missing from
 * the export is the one nobody notices until a dispute needs it.
 */
router.get('/shifts.csv', admin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const range = parseRange(req.query);
  const staffId = /^[0-9a-f-]{36}$/i.test(String(req.query.staffId ?? ''))
    ? String(req.query.staffId)
    : null;
  const window = range
    ? { sql: 'AND s.started_at >= $2::timestamptz AND s.started_at < $4::timestamptz',
        params: [range.from], tail: [range.to] }
    : { sql: "AND s.started_at >= NOW() - ($2 || ' days')::interval",
        params: [String(days)], tail: [] };

  const rows = await queryRows(
    `SELECT r.name, r.valet_role, s.started_at, s.ended_at, s.valet_point,
            s.verified, s.reason,
            EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::bigint
              AS seconds_on_shift
       FROM valet_shifts s
       JOIN residents r ON r.id = s.resident_id
      WHERE s.community_id = $1
        ${window.sql}
        AND ($3::uuid IS NULL OR s.resident_id = $3::uuid)
      ORDER BY s.started_at DESC`,
    [req.user.community_id, window.params[0], staffId, ...window.tail]
  );

  const header = [
    'Name', 'Role', 'In time', 'Out time', 'Time on shift (minutes)',
    'Valet point', 'Verified by', 'Why not verified',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.name,
      r.valet_role || 'valet',
      r.started_at ? new Date(r.started_at).toISOString() : '',
      // An open shift has no out time. Said in words rather than left blank,
      // because a blank in a spreadsheet reads as missing data.
      r.ended_at ? new Date(r.ended_at).toISOString() : 'Still on shift',
      Math.round((Number(r.seconds_on_shift) || 0) / 60),
      r.valet_point ?? '',
      r.verified === true ? 'Face ID' : '',
      r.verified === true ? '' : (r.reason ?? 'unknown'),
    ].map(csvField).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="shift-log-${stamp}.csv"`);
  res.send(lines.join('\n'));
});

router.post('/ideas', admin, async (req, res) => {
  const category = String(req.body.category ?? '');
  // Checked before the insert because the column has a CHECK constraint, and a
  // constraint violation would reach the venue as a 500 they read as "my note
  // was lost" rather than as something they can correct.
  if (!IDEA_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }

  const title = String(req.body.title ?? '').trim().slice(0, 160);
  const body = String(req.body.body ?? '').trim();
  if (!title || !body) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'Give it a short title and tell us what happens today',
    });
  }

  const impact = IDEA_IMPACTS.includes(req.body.impact) ? req.body.impact : null;

  const row = await queryOne(
    `INSERT INTO valet_ideas (community_id, submitted_by, category, title, body, impact, callback)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [
      req.user.community_id,
      req.user.sub ?? null,
      category,
      title,
      body,
      impact,
      req.body.callback === true,
    ]
  );

  // Status is left to default. Anything else here would tell a venue somebody
  // had looked at their note before anybody had.
  res.status(201).json({ id: row?.id, createdAt: row?.created_at });
});

/**
 * A screenshot attached to an idea.
 *
 * "A screen that behaves oddly" is far easier to show than to describe,
 * especially for somebody writing in their second language — which the form
 * explicitly invites. Same 2MB ceiling as every other upload here.
 */
router.post('/ideas/:id/image', admin, logoUpload.single('image'), async (req, res) => {
  const idea = await queryOne(
    'SELECT id, image_key FROM valet_ideas WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!idea) return res.status(404).json({ error: 'not_found' });
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'Choose a PNG or JPG to upload' });
  }

  const key = `valet/ideas/${req.user.community_id}/${req.params.id}-${Date.now()}.${extensionFor(req.file.mimetype)}`;
  await storage.put(key, req.file.buffer, req.file.mimetype);
  await query(
    'UPDATE valet_ideas SET image_key = $3, updated_at = NOW() WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id, key]
  );
  if (idea.image_key) await storage.delete(idea.image_key).catch(() => {});

  res.status(201).json({ hasImage: true });
});

router.get('/ideas', admin, async (req, res) => {
  const rows = await queryRows(
    `SELECT id, category, title, body, impact, callback, status, latest_update, created_at
       FROM valet_ideas
      WHERE community_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [req.user.community_id]
  );

  res.json({
    totals: {
      sent: rows.length,
      // The number that makes a venue believe the channel is real.
      live: rows.filter((r) => r.status === 'live').length,
    },
    ideas: rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      body: r.body,
      impact: r.impact ?? null,
      callback: r.callback === true,
      status: r.status,
      latestUpdate: r.latest_update ?? null,
      createdAt: r.created_at,
    })),
  });
});

router.get('/shifts', admin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);

  // "Who was on at the banquet entrance last Saturday" is the question this
  // screen gets opened to answer, and a rolling 7/30/90 window cannot be bent
  // into a date. The range is one day wide in practice; nothing here insists
  // on that, because a wedding weekend is two.
  const range = parseRange(req.query);
  // Quietly ignored when it is not an id: the value comes from a select box,
  // and a stale option must not take the whole log down.
  const staffId = /^[0-9a-f-]{36}$/i.test(String(req.query.staffId ?? ''))
    ? String(req.query.staffId)
    : null;

  const window = range
    ? { sql: 'AND s.started_at >= $2::timestamptz AND s.started_at < $5::timestamptz',
        params: [range.from], tail: [range.to] }
    : { sql: "AND s.started_at >= NOW() - ($2 || ' days')::interval",
        params: [String(days)], tail: [] };

  const rows = await queryRows(
    `SELECT s.id, r.name, r.valet_role,
            s.started_at, s.ended_at, s.valet_point, s.verified, s.reason,
            EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::bigint
              AS seconds_on_shift
       FROM valet_shifts s
       JOIN residents r ON r.id = s.resident_id
      WHERE s.community_id = $1
        ${window.sql}
        AND ($4::uuid IS NULL OR s.resident_id = $4::uuid)
      ORDER BY s.started_at DESC
      LIMIT $3`,
    // The range's end takes $5, after the positions the day path already uses,
    // so neither branch has to renumber the staff filter -- which is how a
    // filter quietly starts matching against a row limit.
    [req.user.community_id, window.params[0], limit, staffId, ...window.tail]
  );

  res.json({
    days,
    // Null unless a range is in force, so the page labels itself from the
    // answer rather than from what it believes it asked for.
    range,
    shifts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.valet_role || 'valet',
      startedAt: r.started_at,
      // Null means on duty now, which the screen renders as "Still on shift"
      // rather than as a missing value.
      endedAt: r.ended_at ?? null,
      secondsOnShift: Number(r.seconds_on_shift),
      valetPoint: r.valet_point ?? null,
      // Only a real match earns a method. Anything else carries the reason, so
      // "not verified" can be read as the three different situations it is.
      verifiedBy: r.verified === true ? 'face_id' : null,
      reason: r.reason ?? null,
    })),
  });
});

const STAFF_ROLES = ['valet', 'valet_manager', 'temporary_driver'];

/**
 * Correcting a member of staff.
 *
 * The only way to change a role or extend a temp used to be remove-and-re-add,
 * which orphans their shift history -- the exact record the shift log exists
 * to keep. This edits the person instead.
 *
 * Mobile is deliberately not editable here. It is how they sign in to the
 * valet app, and changing somebody's login mid-shift is a different and more
 * dangerous operation than correcting a spelling.
 */
router.patch('/staff/:id', admin, async (req, res) => {
  const role = req.body.role === undefined ? undefined : String(req.body.role);
  if (role !== undefined && !STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_role' });
  }

  const name = req.body.name === undefined
    ? undefined
    : String(req.body.name).trim().slice(0, 200);
  if (name !== undefined && !name) {
    return res.status(400).json({ error: 'missing_fields', message: 'A name cannot be empty' });
  }

  // `until` distinguishes absent (leave it) from null (clear it). A temp made
  // permanent needs the date gone, and treating an empty value as "no change"
  // would leave them expiring on a date the form no longer shows.
  const untilGiven = Object.prototype.hasOwnProperty.call(req.body, 'until');
  const until = untilGiven && req.body.until ? new Date(req.body.until) : null;

  const row = await queryOne(
    `UPDATE residents
        SET name       = COALESCE($3, name),
            valet_role = COALESCE($4, valet_role),
            valet_until = CASE WHEN $5 THEN $6 ELSE valet_until END
      WHERE id = $1 AND community_id = $2 AND type = 'guard'
      RETURNING id, name`,
    [req.params.id, req.user.community_id, name ?? null, role ?? null, untilGiven, until]
  );
  // Scoped to the caller's own property: an id from another venue must not be
  // editable by pasting it into the URL.
  if (!row) return res.status(404).json({ error: 'not_found' });

  res.json({ id: row.id, name: row.name });
});

router.post('/staff', admin, async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const mobile = String(req.body.mobile ?? '').trim();
  const password = String(req.body.password ?? '');
  const role = String(req.body.role ?? 'valet_manager');

  if (!VALET_ROLES.includes(role)) {
    return res.status(400).json({ error: 'invalid_role', message: `role must be one of ${VALET_ROLES.join(', ')}` });
  }
  if (!name || !/^[6-9]\d{9}$/.test(mobile) || password.length < 4) {
    return res.status(400).json({ error: 'invalid_staff', message: 'Name, a 10-digit mobile and a PIN of at least 4 are required' });
  }

  const existing = await queryOne(
    `SELECT id FROM residents
      WHERE community_id = $1 AND mobile = $2 AND type = 'guard' AND is_active = true`,
    [req.user.community_id, mobile]
  );
  if (existing) return res.status(409).json({ error: 'already_exists' });

  // Guards hang off a unit like every other resident row; the post is the
  // unit they belong to.
  let unit = await queryOne(
    "SELECT id FROM units WHERE community_id = $1 AND unit_number = 'GUARD-POST'",
    [req.user.community_id]
  );
  if (!unit) {
    unit = await queryOne(
      // floor stays NULL: the column is INT and a guard post is not on a
      // floor. 'G' for "ground" read naturally and made Postgres reject the
      // whole insert, so the first valet could never be added at a property
      // that had no GUARD-POST unit yet -- which is every property the
      // onboarding flow creates.
      "INSERT INTO units (community_id, unit_number, floor, status) VALUES ($1, 'GUARD-POST', NULL, 'occupied') RETURNING id",
      [req.user.community_id]
    );
  }

  const hash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO residents
       (community_id, unit_id, name, mobile, type, is_primary, password_hash, valet_role, valet_until)
     VALUES ($1, $2, $3, $4, 'guard', false, $5, $6, $7)`,
    [req.user.community_id, unit.id, name, mobile, hash, role,
     role === 'temporary_driver' ? (req.body.until || null) : null]
  );

  res.status(201).json({ added: true });
});

/** Retires a member of staff. Deactivated, never deleted: their name is on tickets. */
router.delete('/staff/:id', admin, async (req, res) => {
  await query(
    `UPDATE residents SET is_active = false
      WHERE id = $1 AND community_id = $2 AND type = 'guard'`,
    [req.params.id, req.user.community_id]
  );
  res.json({ retired: true });
});

/**
 * A car that has pulled up, logged from the desk before a valet reaches it.
 *
 * This is what the three intake states were missing: a producer. At a busy
 * porch cars arrive faster than attendants return, and the desk logging them
 * is how anything reaches the parking queue at all.
 *
 * The plate is optional. The desk often has a car in front of them and no
 * chance to read a registration before the guest is out of it -- and a form
 * that insists is a form nobody fills in at the moment it would help.
 */
router.post('/tickets/request', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const plate = String(req.body.plate ?? '').trim().toUpperCase();

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');

    // The same per-venue advisory lock every other way of minting a display id
    // takes (see POST /guard/tickets). Without it a desk log racing a card
    // scan read the same "last" id, and one of them died on
    // UNIQUE (community_id, display_id).
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('valet_display_id'), hashtext($1))`,
      [communityId]
    );
    const last = await client.query(
      `SELECT display_id FROM valet_tickets
        WHERE community_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [communityId]
    );

    // created_by_guard_id stays NULL. It references residents(id) and the
    // caller is an admin, so writing req.user.sub there failed the foreign key
    // and every desk log answered 500. Nobody has driven the car yet; the
    // attendant who accepts the job fills it in, and who logged it is on the
    // event below.
    const inserted = await client.query(
      `INSERT INTO valet_tickets
         (community_id, display_id, session_token, claim_code, status,
          created_by_guard_id, plate, plate_normalized)
       VALUES ($1, $2, $3, $4, 'requested', NULL, $5, $6)
       RETURNING id, display_id, session_token, claim_code`,
      [communityId, nextDisplayId(last.rows[0]?.display_id), newSessionToken(), newClaimCode(),
       plate || null, plate ? normalizePlate(plate) : null]
    );
    created = inserted.rows[0];

    await logEvent(created.id, 'logged_at_desk', {
      metadata: { loggedBy: req.user.sub, role: req.user.role, ...(plate ? { plate } : {}) },
      client,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({
    id: created.id,
    displayId: created.display_id,
    sessionToken: created.session_token,
    claimCode: created.claim_code,
  });
});

/**
 * Short-lived links to a ticket's condition photos and videos, for the portal.
 *
 * The portal's ticket page rendered <img src> straight at the guard media
 * route, which needs a bearer token -- and an <img> sends none, so every tile
 * was a broken image. Same fix as the valet app's handover photo
 * (lib/photo-link.js): ask for links signed for one item each, then load them
 * with no header at all.
 *
 * Every link names one media record in the admin's own community, carries its
 * own purpose claim, and lives two minutes. The page asks again when it is
 * reopened; nothing here is meant to be bookmarked.
 */
router.post('/tickets/:token/media-links', admin, async (req, res) => {
  const ticket = await queryOne(
    'SELECT id FROM valet_tickets WHERE session_token = $1 AND community_id = $2',
    [req.params.token, req.user.community_id]
  );
  if (!ticket) return res.status(404).json({ error: 'not_found' });

  const rows = await queryRows(
    `SELECT id FROM valet_condition_records
      WHERE ticket_id = $1 AND deleted_at IS NULL
      ORDER BY captured_at ASC`,
    [ticket.id]
  );

  const links = {};
  for (const r of rows) {
    links[r.id] = `/admin/media-links/${signMediaLink(r.id, req.user.community_id)}`;
  }
  res.json({ links, expiresIn: MEDIA_LINK_TTL_SECONDS });
});

// No admin middleware: the signature is the credential. Every refusal is the
// same bare 404 -- bad signature, expired, another property's media, or media
// the retention sweep has since deleted -- so a probe learns nothing.
router.get('/media-links/:sig', async (req, res) => {
  const link = verifyMediaLink(req.params.sig);
  if (!link) return res.status(404).json({ error: 'not_found' });

  // Re-checked at read time, community included, rather than trusting what
  // was true when the link was signed.
  const record = await queryOne(
    `SELECT r.storage_key FROM valet_condition_records r
       JOIN valet_tickets t ON t.id = r.ticket_id
      WHERE r.id = $1 AND t.community_id = $2 AND r.deleted_at IS NULL`,
    [link.mediaId, link.communityId]
  );
  if (!record) return res.status(404).json({ error: 'not_found' });

  const stream = await storage.getStream(record.storage_key);
  if (!stream) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', contentTypeFor(record.storage_key));
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

/**
 * Enrols a member of staff for shift-start verification.
 *
 * The photo is sent to the recogniser, the vector comes back, and the photo is
 * gone. face_enrollments has held vectors and never images since it was
 * written, and that is the whole reason it is safe to hold at all.
 *
 * Refused outright when the recogniser cannot produce a vector, rather than
 * writing a row without one: an enrolment that matches nothing looks exactly
 * like somebody who is set up, right up until the morning it matters.
 */
router.post('/staff/:id/face', admin, async (req, res) => {
  const scan = String(req.body.imageBase64 || '');
  if (!scan) return res.status(400).json({ error: 'image_required' });

  const member = await queryOne(
    `SELECT id, unit_id FROM residents
      WHERE id = $1 AND community_id = $2 AND type = 'guard' AND is_active = true`,
    [req.params.id, req.user.community_id]
  );
  if (!member) return res.status(404).json({ error: 'not_found' });

  const vector = await vectorize(scan);
  if (!vector) {
    return res.status(503).json({
      error: 'recognition_unavailable',
      message: 'Face recognition is not available, so nobody was enrolled',
    });
  }

  await query(
    `INSERT INTO face_enrollments
       (community_id, unit_id, resident_id, status, vector, enrolled_at, activated_at)
     VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())
     ON CONFLICT (resident_id) DO UPDATE
        SET vector = EXCLUDED.vector, status = 'active', activated_at = NOW()`,
    [req.user.community_id, member.unit_id, member.id, vector]
  );

  res.status(201).json({ enrolled: true });
});

/**
 * Whether a photo taken here has anywhere to go.
 *
 * The staff page offered "Add photo" regardless of the deployment, and every
 * press ended in a 503 -- the refusal is right, but a button that can only
 * fail should not be offered. Asked once, so the page can explain instead.
 */
router.get('/face/status', admin, async (req, res) => {
  res.json({ configured: isRecognitionConfigured() });
});

// --- quota and advertising --------------------------------------------------
//
// The commercial layer. Nothing in here invents a price: every rate is read
// from the account row, which is where migration 069 put the defaults so that
// a change of terms is a settings edit rather than a release.

/** The account's commercial terms, with the migration's defaults as a floor. */
function accountTerms(accountId) {
  return queryOne(
    `SELECT quota_mode, quota_cars_per_property, quota_alert_percent,
            quota_over_behaviour, quota_overage_paise,
            ad_price_per_view_paise, ad_monthly_minimum_paise, gst_percent, ad_billing
       FROM accounts WHERE id = $1`,
    [accountId]
  );
}

/**
 * The shared car pool, and where each property stands in it.
 *
 * Group admins only. A manager of one property has no pool to share and no
 * settings to change; showing them a quota panel would imply a choice they do
 * not have and a group they are not part of.
 */
router.get('/quota', admin, async (req, res) => {
  if (!groupOnly(req, res)) return;

  const terms = await accountTerms(req.user.account_id);
  if (!terms) return res.status(404).json({ error: 'not_found' });

  const rows = await queryRows(
    `SELECT c.id, c.name, c.valet_quota_hold_back AS hold_back,
            (SELECT COUNT(*) FROM valet_tickets t
              WHERE t.community_id = c.id
                AND t.created_at >= date_trunc('month', NOW()))::int AS cars_this_month,
            EXISTS (SELECT 1 FROM valet_tickets t WHERE t.community_id = c.id) AS ever_live
       FROM communities c
      WHERE c.account_id = $1
      ORDER BY c.name`,
    [req.user.account_id]
  );

  const properties = rows.map((r) => ({
    id: r.id,
    name: r.name,
    holdBack: Number(r.hold_back ?? 0),
    carsThisMonth: Number(r.cars_this_month ?? 0),
    status: r.ever_live ? 'live' : 'setting_up',
  }));

  const pool = quotaFor({
    properties,
    carsPerProperty: terms.quota_cars_per_property,
    mode: terms.quota_mode,
  });

  // Days left in the month, which is what makes "4,950 of 6,000" actionable:
  // the same number four days from the end means something very different
  // from the same number on the 3rd.
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

  res.json({
    settings: {
      mode: terms.quota_mode,
      carsPerProperty: terms.quota_cars_per_property,
      alertPercent: terms.quota_alert_percent,
      overBehaviour: terms.quota_over_behaviour,
      // Null when no rate has been agreed, and the screen says so rather than
      // printing a number nobody signed.
      overagePaise: terms.quota_overage_paise ?? null,
    },
    pool: { ...pool, daysLeft },
    properties: properties.map((p) => ({
      ...p,
      // Against this property's own share, which is what "2,700 of 2,000"
      // means on the design's row.
      includedCars: p.status === 'live' ? terms.quota_cars_per_property : 0,
    })),
  });
});

/**
 * Change how the group's cars are shared.
 *
 * Deliberately NOT editable here: cars per property and the overage rate.
 * Those are contract terms. A screen that let a customer set their own
 * allowance would be a billing hole, and one that let them set their own
 * overage rate would be a stranger one.
 */
router.patch('/quota', admin, async (req, res) => {
  if (!groupOnly(req, res)) return;

  const sets = [];
  const params = [req.user.account_id];

  if (req.body.mode !== undefined) {
    if (!['shared', 'fixed'].includes(String(req.body.mode))) {
      return res.status(400).json({ error: 'invalid_mode' });
    }
    params.push(String(req.body.mode));
    sets.push(`quota_mode = $${params.length}`);
  }

  if (req.body.alertPercent !== undefined) {
    const pct = parseInt(req.body.alertPercent, 10);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'invalid_alert_percent' });
    }
    params.push(pct);
    sets.push(`quota_alert_percent = $${params.length}`);
  }

  if (req.body.overBehaviour !== undefined) {
    // 'stop' is not offered, here or in the schema: a billing arrangement must
    // never be able to refuse a guest standing at a porch with their keys out.
    if (!['bill', 'notify'].includes(String(req.body.overBehaviour))) {
      return res.status(400).json({ error: 'invalid_over_behaviour' });
    }
    params.push(String(req.body.overBehaviour));
    sets.push(`quota_over_behaviour = $${params.length}`);
  }

  if (sets.length > 0) {
    await query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  // Hold-backs arrive as a map of property to cars. Written one at a time and
  // scoped to the account, so a group admin cannot reserve cars at a hotel
  // that is not theirs by posting somebody else's id.
  const holdBack = req.body.holdBack;
  if (holdBack && typeof holdBack === 'object') {
    for (const [id, raw] of Object.entries(holdBack)) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      const cars = parseInt(raw, 10);
      if (!Number.isFinite(cars) || cars < 0) {
        return res.status(400).json({ error: 'invalid_hold_back' });
      }
      await query(
        'UPDATE communities SET valet_quota_hold_back = $3 WHERE id = $1 AND account_id = $2',
        [id, req.user.account_id, cars]
      );
    }
  }

  if (sets.length === 0 && !holdBack) {
    return res.status(400).json({ error: 'nothing_to_change' });
  }

  res.json({ saved: true });
});

/**
 * Who owns the ad balance: the group if there is one, the property otherwise.
 *
 * A single hotel with no group still buys promotions, and the ledger's CHECK
 * constraint insists exactly one owner is set -- a row belonging to both can
 * be counted twice, and a row belonging to neither cannot be counted at all.
 */
function adOwner(user) {
  return user.role === 'client_admin' && user.account_id
    ? { column: 'account_id', id: user.account_id }
    : { column: 'community_id', id: user.community_id };
}

/** Terms for whoever owns the balance; a lone property falls back to defaults. */
async function adTerms(user) {
  if (user.role === 'client_admin' && user.account_id) {
    return accountTerms(user.account_id);
  }
  const row = await queryOne(
    `SELECT a.ad_price_per_view_paise, a.ad_monthly_minimum_paise, a.gst_percent, a.ad_billing
       FROM communities c LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = $1`,
    [user.community_id]
  );
  // A property with no account has no negotiated terms, so it gets the
  // published ones. Stated here rather than defaulted silently in three places.
  return {
    ad_price_per_view_paise: row?.ad_price_per_view_paise ?? 150,
    ad_monthly_minimum_paise: row?.ad_monthly_minimum_paise ?? 200000,
    gst_percent: row?.gst_percent ?? 18,
    ad_billing: row?.ad_billing ?? 'prepaid',
  };
}

/**
 * What advertising costs here, and what has been paid toward it.
 *
 * The balance is summed from the ledger rather than read from a column: a
 * running total is a number somebody has to keep correct under concurrency,
 * and the first time it drifts nobody can say when or why.
 */
router.get('/ads', admin, async (req, res) => {
  const terms = await adTerms(req.user);
  const owner = adOwner(req.user);

  const ledger = await queryRows(
    `SELECT amount_paise, is_credit FROM valet_ad_ledger WHERE ${owner.column} = $1`,
    [owner.id]
  );
  const balance = balanceFromLedger(ledger);

  const recent = await queryRows(
    `SELECT kind, amount_paise, is_credit, note, order_ref, created_at
       FROM valet_ad_ledger
      WHERE ${owner.column} = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [owner.id]
  );

  // Delivered views this month, which is what the spend is actually made of.
  const views = await queryOne(
    `SELECT COUNT(*)::int AS views
       FROM valet_promotion_events e
       JOIN valet_promotions p ON p.id = e.promotion_id
      WHERE e.kind = 'view'
        AND e.created_at >= date_trunc('month', NOW())
        AND p.community_id = ANY($1::uuid[])`,
    [await promotionScope(req.user)]
  );

  const deliveredPaise = viewCostPaise(views?.views ?? 0, terms.ad_price_per_view_paise);

  res.json({
    pricing: {
      perViewPaise: terms.ad_price_per_view_paise,
      monthlyMinimumPaise: terms.ad_monthly_minimum_paise,
      gstPercent: terms.gst_percent,
      billing: terms.ad_billing,
    },
    balance,
    monthToDate: {
      views: views?.views ?? 0,
      ...withGst(deliveredPaise, terms.gst_percent),
    },
    ledger: recent.map((r) => ({
      kind: r.kind,
      amountPaise: Number(r.amount_paise),
      isCredit: r.is_credit === true,
      note: r.note ?? null,
      orderRef: r.order_ref ?? null,
      at: r.created_at,
    })),
    // Said on every response rather than inferred by the client: a venue must
    // never be told money moved when the payment layer cannot move any.
    paymentPlaceholder: isPlaceholderMode(),
  });
});

/** Which properties' promotions this caller's spend covers. */
async function promotionScope(user) {
  if (user.role === 'client_admin' && user.account_id) {
    const rows = await queryRows(
      'SELECT id FROM communities WHERE account_id = $1', [user.account_id]
    );
    return rows.map((r) => r.id);
  }
  return [user.community_id];
}

/**
 * Add to the ad balance.
 *
 * Mints an order and records the ledger row in the same request, which is
 * correct ONLY because placeholder orders cannot fail. When this goes live the
 * credit must move to the payment webhook -- crediting on intent rather than
 * on settlement would hand a venue a balance for a payment they abandoned.
 * The route refuses to pretend otherwise: in live mode it returns the order
 * and credits nothing.
 */
router.post('/ads/topup', admin, async (req, res) => {
  const amountPaise = parseInt(req.body.amountPaise, 10);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return res.status(400).json({ error: 'invalid_amount' });
  }
  // A ceiling, because a mistyped amount is far more likely than a genuine
  // one this size, and an accidental ten-lakh top-up is a refund conversation.
  if (amountPaise > 10000000) {
    return res.status(400).json({ error: 'amount_too_large', message: 'Top up ₹1,00,000 or less at a time' });
  }

  const terms = await adTerms(req.user);
  if (terms.ad_billing === 'invoiced') {
    return res.status(409).json({
      error: 'invoiced_account',
      message: 'This account is invoiced monthly. Promotion spend is added to your Dwaar AI invoice.',
    });
  }

  const owner = adOwner(req.user);
  const totals = withGst(amountPaise, terms.gst_percent);
  const order = await createAdOrder(totals.totalPaise, `valet-ads-${Date.now()}`);

  if (order.placeholder) {
    // The ledger carries the NET, not the total: GST is tax collected, not ad
    // credit. Crediting the gross would hand every venue 18% of free spend.
    await query(
      `INSERT INTO valet_ad_ledger (${owner.column}, amount_paise, kind, order_ref, note)
       VALUES ($1, $2, 'topup', $3, $4)
       ON CONFLICT (order_ref) WHERE order_ref IS NOT NULL DO NOTHING`,
      [owner.id, amountPaise, order.id, 'Recorded in placeholder mode — no money collected']
    );
  }

  res.status(201).json({
    orderId: order.id,
    ...totals,
    paymentPlaceholder: order.placeholder,
    credited: order.placeholder,
  });
});

/**
 * Send a promotion for review.
 *
 * Dwaar AI checks every promotion before it reaches a guest's phone, so a
 * venue cannot put it live themselves. Draft to in_review is the whole
 * transition; approval is an operator action.
 */
router.post('/promotions/:id/submit', admin, async (req, res) => {
  const row = await queryOne(
    `UPDATE valet_promotions SET status = 'in_review', updated_at = NOW()
      WHERE id = $1 AND community_id = $2 AND status = 'draft'
      RETURNING id, status`,
    [req.params.id, req.user.community_id]
  );
  // Not found and not-a-draft are the same answer on purpose: both mean "there
  // is no draft here to send", and distinguishing them tells a caller which
  // ids exist at other properties.
  if (!row) return res.status(409).json({ error: 'not_a_draft' });
  res.json({ id: row.id, status: row.status });
});
