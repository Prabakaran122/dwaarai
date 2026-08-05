import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import { deviceLimiter } from '../middleware/rateLimit.js';
import { platformFeePaise, stallTotalPaise } from '../lib/money.js';
import { createOrder, getKeyId, isLiveMode } from '../lib/razorpay.js';
import pool from '../db/pool.js';

const router = Router();

// THIS IS THE ONLY UNAUTHENTICATED WRITE SURFACE IN THE SYSTEM (BRD FR-GST-05:
// an RWA shares a link with an external vendor who has no resident login).
// Every other route in the API requires a JWT — treat everything below with
// the scrutiny that implies:
//   - the token is a 32-byte random value (crypto.randomBytes), never
//     sequential and never derived from the event id, so it cannot be
//     guessed or enumerated from a known event;
//   - an unknown token, an expired token and a revoked token ALL 404 with
//     the exact same message — distinguishing them would let a caller learn
//     which tokens once existed (an enumeration oracle);
//   - the public stall list leaks nothing about residents: no name, unit
//     number, mobile, or even whether the existing booker was a resident or
//     a guest — see PUBLIC_LIST_SQL below, which selects only stall/booking
//     -status columns, the same shape routes/stalls.js uses for its own list;
//   - money is computed server-side from the locked stall row, exactly like
//     the resident booking path in routes/stalls.js — a guest cannot name
//     their own price any more than a resident can;
//   - the same `uniq_live_booking_per_stall` partial unique index (migration
//     041) arbitrates a resident vs. a guest racing for the same stall —
//     there is only one index, so there can only be one winner regardless of
//     who they are;
//   - the SMS receipt is intentionally NOT sent from this file. It is sent
//     from the payment webhook's settlement path (routes/dues.js), because a
//     receipt must state a payment that actually happened, not a reservation
//     that might never be paid for. See the deviation note in the task
//     report — wiring that send is out of scope for this file.

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://dwaarai.com';
const DEFAULT_LINK_EXPIRY_HOURS = 72;

// -- token lookup ---------------------------------------------------------
//
// One query, one shape of "not usable" result (null) for three different
// reasons (never existed, expired, revoked). The route layer must not be
// able to tell these apart, so we deliberately don't hand back *why* a
// token failed — only whether it is currently usable.
async function findActiveLink(token) {
  return queryOne(
    `SELECT id, event_id, community_id FROM guest_booking_links
      WHERE token = $1 AND is_revoked = false AND (expires_at IS NULL OR expires_at > NOW())`,
    [token]
  );
}

// -- Indian mobile validation ----------------------------------------------
//
// Accepts a bare 10-digit number, or one prefixed with 91/+91, and always
// returns the bare 10-digit form (what stall_bookings.guest_mobile stores)
// or null if it isn't a valid Indian mobile number (starts 6-9, 10 digits).
function normalizeIndianMobile(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?91/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

// Mirrors routes/stalls.js's LIST_SQL exactly — same predicate, same
// columns. No resident_id, unit_id, guest_name, guest_mobile or booker_kind
// is selected, so there is nothing here for a public caller to learn about
// who booked a stall, resident or guest.
const PUBLIC_LIST_SQL = `
  SELECT es.id, es.code, es.stall_type, es.price_paise, es.row_index, es.col_index,
         sb.status AS booking_status
    FROM event_stalls es
    LEFT JOIN stall_bookings sb
      ON sb.stall_id = es.id AND sb.status <> 'released'
   WHERE es.event_id = $1 AND es.is_active = true
   ORDER BY es.row_index ASC, es.col_index ASC`;

function shapePublicStall(s) {
  const pricePaise = Number(s.price_paise);
  return {
    id: s.id,
    code: s.code,
    stallType: s.stall_type,
    pricePaise,
    platformFeePaise: platformFeePaise(pricePaise),
    totalPaise: stallTotalPaise(pricePaise),
    status: s.booking_status ? 'booked' : 'available',
    row: s.row_index,
    col: s.col_index,
  };
}

// -- POST /admin/events/:id/guest-link (admin) --------------------------------

const guestLinkSchema = z.object({
  expiresInHours: z.number().int().positive().max(24 * 30).optional(),
});

router.post('/admin/events/:id/guest-link', authenticateJWT(['admin']), async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return error(res, 'Insufficient permissions', 403);
    }

    const parsed = guestLinkSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const expiresInHours = parsed.data.expiresInHours ?? DEFAULT_LINK_EXPIRY_HOURS;

    const { community_id } = req.user;
    const ev = await queryOne(
      'SELECT id FROM events WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!ev) {
      return error(res, 'Event not found', 404);
    }

    // 32 bytes of CSPRNG output, hex-encoded to 64 chars — matches
    // guest_booking_links.token VARCHAR(64) exactly. Never sequential,
    // never a function of the event id: knowing one event's link tells you
    // nothing about any other event's link.
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO guest_booking_links (event_id, community_id, token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, community_id, token, expiresAt]
    );

    return success(res, {
      token,
      url: `${PUBLIC_APP_URL}/public/stalls/${token}`,
      expiresAt,
    }, 201);
  } catch (err) {
    console.error('POST /admin/events/:id/guest-link error:', err.message);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /public/stalls/:token (no auth) ---------------------------------------

router.get('/public/stalls/:token', async (req, res) => {
  try {
    const link = await findActiveLink(req.params.token);
    if (!link) {
      // Same message and status for unknown, expired AND revoked — do not
      // distinguish, or the response itself becomes an enumeration oracle.
      return error(res, 'Link not found', 404);
    }

    const rows = await queryRows(PUBLIC_LIST_SQL, [link.event_id]);
    const stalls = rows.map(shapePublicStall);
    const available = stalls.filter((s) => s.status === 'available').length;

    return success(res, { eventId: link.event_id, stalls, available, total: stalls.length });
  } catch (err) {
    console.error('GET /public/stalls/:token error:', err.message);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /public/stalls/:token/book (no auth) ---------------------------------
//
// Rate-limited with the existing `deviceLimiter` (services/api-gateway/src/
// middleware/rateLimit.js) — it keys on X-Device-Token when present, and
// falls back to req.ip otherwise, which is exactly this caller's situation
// since a public/anonymous booking never carries a device token. 10 requests
// per minute per caller. This is the only rate-limit middleware that exists
// in the repo; nothing purpose-built for this endpoint was added.

const guestBookSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  guestMobile: z.string().min(1),
  stallId: z.string().min(1),
});

router.post('/public/stalls/:token/book', deviceLimiter, async (req, res) => {
  const parsed = guestBookSchema.safeParse(req.body);
  if (!parsed.success) {
    return error(res, 'Validation error', 400, parsed.error.issues);
  }
  const { guestName, guestMobile, stallId } = parsed.data;

  const normalizedMobile = normalizeIndianMobile(guestMobile);
  if (!normalizedMobile) {
    return error(res, 'guestMobile must be a valid Indian mobile number', 400);
  }

  const link = await findActiveLink(req.params.token).catch((err) => {
    console.error('POST /public/stalls/:token/book link lookup error:', err.message);
    return undefined;
  });
  if (link === undefined) {
    return error(res, 'Internal server error', 500);
  }
  if (!link) {
    return error(res, 'Link not found', 404);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the stall row so a resident and a guest racing for the same
    // stall serialize here, exactly like routes/stalls.js's resident path.
    const stallResult = await client.query(
      `SELECT id, code, price_paise FROM event_stalls
        WHERE id = $1 AND event_id = $2 AND community_id = $3 AND is_active = true
        FOR UPDATE`,
      [stallId, link.event_id, link.community_id]
    );
    if (!stallResult.rows.length) {
      await client.query('ROLLBACK');
      return error(res, 'Stall not found', 404);
    }
    const stall = stallResult.rows[0];

    // Server-computed from the LOCKED stall row — never from the request
    // body. A guest naming their own price is exactly as much a money bug
    // as a resident doing it.
    const stallFeePaise = Number(stall.price_paise);
    const platformFee = platformFeePaise(stallFeePaise);
    const totalPaise = stallTotalPaise(stallFeePaise);

    let bookingId;
    try {
      const bookingResult = await client.query(
        `INSERT INTO stall_bookings
           (stall_id, event_id, community_id, booker_kind, guest_name, guest_mobile,
            stall_fee_paise, platform_fee_paise, total_paise, status)
         VALUES ($1, $2, $3, 'guest', $4, $5, $6, $7, $8, 'reserved')
         RETURNING id`,
        [stall.id, link.event_id, link.community_id, guestName, normalizedMobile, stallFeePaise, platformFee, totalPaise]
      );
      bookingId = bookingResult.rows[0].id;
    } catch (err) {
      if (err && err.code === '23505') {
        // uniq_live_booking_per_stall (migration 041) — the SAME index that
        // arbitrates a resident-vs-resident race also arbitrates a
        // resident-vs-guest or guest-vs-guest race. One winner, one 409.
        await client.query('ROLLBACK');
        return error(res, `Stall ${stall.code} is already booked`, 409);
      }
      throw err;
    }

    const orderRow = await client.query(
      `INSERT INTO payment_orders
         (community_id, purpose, subject_id, amount_paise, platform_fee_paise, gateway, status, test_mode)
       VALUES ($1, 'stall', $2, $3, $4, 'razorpay', 'created', $5)
       RETURNING id`,
      [link.community_id, bookingId, totalPaise, platformFee, !isLiveMode()]
    );
    const orderId = orderRow.rows[0].id;

    const receipt = `guest_${String(bookingId).slice(0, 8)}`;
    const gatewayOrder = await createOrder(totalPaise, receipt);

    await client.query('UPDATE payment_orders SET gateway_order_id = $1 WHERE id = $2', [gatewayOrder.id, orderId]);
    await client.query('UPDATE stall_bookings SET order_id = $1 WHERE id = $2', [orderId, bookingId]);

    await client.query('COMMIT');

    // guest_mobile is personal data under the DPDP Act 2023 (BRD NFR:
    // retained for event + 90 days, never indefinitely). It is stored above
    // exactly once, is never logged (see the catch blocks in this file —
    // they log err.message only, never req.body), and is not returned in
    // this response. The deletion/anonymization job itself does not exist
    // yet and belongs alongside services/api-gateway/src/cron/
    // generate-visits.js as a new daily cron: null out guest_mobile on any
    // stall_bookings row whose event has ended more than 90 days ago. Not
    // implemented here — flagging so the 90-day retention limit isn't
    // silently missed.
    return success(res, {
      bookingId,
      orderId,
      gatewayOrderId: gatewayOrder.id,
      keyId: getKeyId(),
      amountPaise: totalPaise,
      testMode: !isLiveMode(),
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /public/stalls/:token/book error:', err.message);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

export default router;
