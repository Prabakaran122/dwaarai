import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import { platformFeePaise, stallTotalPaise } from '../lib/money.js';
import { createOrder, getKeyId, isLiveMode } from '../lib/razorpay.js';
import pool from '../db/pool.js';

const router = Router();

const STALL_TYPES = ['standard', 'premium', 'corner'];

const stallLayoutItemSchema = z.object({
  code: z.string().min(1).max(20),
  stallType: z.enum(STALL_TYPES).optional().default('standard'),
  pricePaise: z.number().int().min(0),
  row: z.number().int().min(0).optional().default(0),
  col: z.number().int().min(0).optional().default(0),
});

const stallLayoutSchema = z.object({
  stalls: z.array(stallLayoutItemSchema).min(1),
});

// Derive a stall's status from a left-join on stall_bookings restricted to
// status <> 'released' — this predicate MUST match uniq_live_booking_per_stall
// exactly (migration 041), otherwise the map here disagrees with what the
// database will actually allow to be booked.
const LIST_SQL = `
  SELECT es.id, es.code, es.stall_type, es.price_paise, es.row_index, es.col_index,
         sb.status AS booking_status
    FROM event_stalls es
    LEFT JOIN stall_bookings sb
      ON sb.stall_id = es.id AND sb.status <> 'released'
   WHERE es.event_id = $1 AND es.is_active = true
   ORDER BY es.row_index ASC, es.col_index ASC`;

function shapeStall(s) {
  const pricePaise = Number(s.price_paise);
  return {
    id: s.id,
    code: s.code,
    stallType: s.stall_type,
    pricePaise,
    platformFeePaise: platformFeePaise(pricePaise),
    totalPaise: stallTotalPaise(pricePaise),
    // Any non-released booking (reserved or booked) occupies the stall — it
    // cannot be won by anyone else, so it reads as 'booked' to the caller.
    status: s.booking_status ? 'booked' : 'available',
    row: s.row_index,
    col: s.col_index,
  };
}

// -- GET /events/:id/stalls ----------------------------------------------------

router.get('/events/:id/stalls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    const ev = await queryOne(
      'SELECT id FROM events WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!ev) {
      return error(res, 'Event not found', 404);
    }

    const rows = await queryRows(LIST_SQL, [req.params.id]);
    const stalls = rows.map(shapeStall);
    const available = stalls.filter((s) => s.status === 'available').length;

    return success(res, { stalls, available, total: stalls.length });
  } catch (err) {
    console.error('GET /events/:id/stalls error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/events/:id/stalls --------------------------------------------

router.post('/admin/events/:id/stalls', authenticateJWT(['admin']), async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return error(res, 'Insufficient permissions', 403);
    }

    const parsed = stallLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { stalls } = parsed.data;

    const codes = new Set();
    for (const s of stalls) {
      if (codes.has(s.code)) {
        return error(res, `Duplicate stall code in layout: ${s.code}`, 400);
      }
      codes.add(s.code);
    }

    const { community_id } = req.user;
    const ev = await queryOne(
      'SELECT id, community_id FROM events WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!ev) {
      return error(res, 'Event not found', 404);
    }

    for (const s of stalls) {
      await query(
        `INSERT INTO event_stalls (event_id, community_id, code, stall_type, price_paise, row_index, col_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, community_id, s.code, s.stallType, s.pricePaise, s.row, s.col]
      );
    }

    return success(res, { created: stalls.length }, 201);
  } catch (err) {
    if (err && err.code === '23505') {
      return error(res, 'A stall with that code already exists for this event', 409);
    }
    console.error('POST /admin/events/:id/stalls error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /events/:id/stalls/:stallId/book (resident) -------------------------
//
// The BRD's sharpest acceptance criterion: two residents booking the same
// stall simultaneously must produce exactly one booking and one clear error
// — never two bookings, never a 500. That guarantee is NOT an application
// check here (a SELECT-then-INSERT cannot promise it under concurrency); it
// is `uniq_live_booking_per_stall` (migration 041), a partial unique index on
// stall_bookings(stall_id) WHERE status <> 'released'. This handler:
//   - locks the stall row (FOR UPDATE) so concurrent attempts on the SAME
//     stall serialize instead of racing independently,
//   - inserts the booking as 'reserved', never 'booked' — money has not
//     moved yet, and only the payment webhook may promote it,
//   - computes stall_fee / platform_fee / total from the LOCKED stall row,
//     never from the request body — a client naming its own price is a
//     money bug,
//   - catches the 23505 that index raises (belt-and-suspenders: the FOR
//     UPDATE lock should already have serialized the loser into it) and
//     turns it into a 409 that names the stall, never a 500.
router.post('/events/:id/stalls/:stallId/book', authenticateJWT(['resident']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { community_id, unit_id, sub } = req.user;

    const ev = await client.query(
      'SELECT id FROM events WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!ev.rows.length) {
      return error(res, 'Event not found', 404);
    }

    await client.query('BEGIN');

    // Lock the stall row itself so two concurrent booking attempts on the
    // SAME stall serialize here rather than both racing the INSERT below.
    const stallResult = await client.query(
      `SELECT id, code, price_paise FROM event_stalls
        WHERE id = $1 AND event_id = $2 AND community_id = $3 AND is_active = true
        FOR UPDATE`,
      [req.params.stallId, req.params.id, community_id]
    );
    if (!stallResult.rows.length) {
      await client.query('ROLLBACK');
      return error(res, 'Stall not found', 404);
    }
    const stall = stallResult.rows[0];

    const stallFeePaise = Number(stall.price_paise);
    const platformFee = platformFeePaise(stallFeePaise);
    const totalPaise = stallTotalPaise(stallFeePaise);

    let bookingId;
    try {
      const bookingResult = await client.query(
        `INSERT INTO stall_bookings
           (stall_id, event_id, community_id, booker_kind, resident_id, unit_id,
            stall_fee_paise, platform_fee_paise, total_paise, status)
         VALUES ($1, $2, $3, 'resident', $4, $5, $6, $7, $8, 'reserved')
         RETURNING id`,
        [stall.id, req.params.id, community_id, sub, unit_id, stallFeePaise, platformFee, totalPaise]
      );
      bookingId = bookingResult.rows[0].id;
    } catch (err) {
      if (err && err.code === '23505') {
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
      [community_id, bookingId, totalPaise, platformFee, !isLiveMode()]
    );
    const orderId = orderRow.rows[0].id;

    const receipt = `stall_${String(bookingId).slice(0, 8)}`;
    const gatewayOrder = await createOrder(totalPaise, receipt);

    await client.query('UPDATE payment_orders SET gateway_order_id = $1 WHERE id = $2', [gatewayOrder.id, orderId]);
    await client.query('UPDATE stall_bookings SET order_id = $1 WHERE id = $2', [orderId, bookingId]);

    await client.query('COMMIT');

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
    console.error('POST /events/:id/stalls/:stallId/book error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

export default router;
