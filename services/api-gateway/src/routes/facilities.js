import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helper: build time slots between open and close times
// open/close are 'HH:MM' or 'HH:MM:SS'; returns [{ start:'HH:MM', end:'HH:MM' }]
// ---------------------------------------------------------------------------
function buildSlots(open, close, slotMin) {
  const toMin = (t) => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };
  const pad = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const slots = [];
  for (let s = toMin(open); s + slotMin <= toMin(close); s += slotMin) slots.push({ start: pad(s), end: pad(s + slotMin) });
  return slots;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const bookSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
});

// ---------------------------------------------------------------------------
// GET /facilities/mine  — MUST be registered BEFORE /facilities/:id/...
// so that Express does not swallow 'mine' as a facility ID param.
// ---------------------------------------------------------------------------
router.get('/facilities/mine', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const today = new Date().toISOString().slice(0, 10);

    const bookings = await queryRows(
      `SELECT fb.id,
              f.name  AS facility_name,
              f.sport,
              fb.booking_date::text AS date,
              to_char(fb.start_time, 'HH24:MI') AS start,
              to_char(fb.end_time,   'HH24:MI') AS end
       FROM facility_bookings fb
       JOIN facilities f ON f.id = fb.facility_id
       WHERE fb.unit_id = $1
         AND fb.status = 'booked'
         AND fb.booking_date >= $2
       ORDER BY fb.booking_date, fb.start_time`,
      [user.unit_id, today]
    );

    const shaped = bookings.map((b) => ({
      id: b.id,
      facilityName: b.facility_name,
      sport: b.sport,
      date: b.date,
      start: b.start,
      end: b.end,
    }));

    return success(res, shaped);
  } catch (err) {
    console.error('GET /facilities/mine error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /facilities — list active facilities for the community
// ---------------------------------------------------------------------------
router.get('/facilities', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;

    const facilities = await queryRows(
      `SELECT id, name, sport, open_time, close_time, slot_minutes
       FROM facilities
       WHERE community_id = $1 AND is_active = TRUE
       ORDER BY name`,
      [user.community_id]
    );

    const shaped = facilities.map((f) => ({
      id: f.id,
      name: f.name,
      sport: f.sport,
      openTime: String(f.open_time).slice(0, 5),
      closeTime: String(f.close_time).slice(0, 5),
      slotMinutes: f.slot_minutes,
    }));

    return success(res, shaped);
  } catch (err) {
    console.error('GET /facilities error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /facilities/:id/availability?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
router.get('/facilities/:id/availability', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const facilityId = req.params.id;
    const { date } = req.query;

    // Validate date format
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return error(res, 'Invalid date format. Use YYYY-MM-DD', 400);
    }

    // Load facility (must belong to this community)
    const facility = await queryOne(
      `SELECT id, name, sport, open_time, close_time, slot_minutes
       FROM facilities
       WHERE id = $1 AND community_id = $2 AND is_active = TRUE`,
      [facilityId, user.community_id]
    );
    if (!facility) {
      return error(res, 'Facility not found', 404);
    }

    // Query bookings for this facility + date
    const bookings = await queryRows(
      `SELECT to_char(start_time, 'HH24:MI') AS start_time, unit_id
       FROM facility_bookings
       WHERE facility_id = $1 AND booking_date = $2 AND status = 'booked'`,
      [facilityId, date]
    );

    // Build a map of start -> unit_id for fast lookup
    const bookedMap = new Map(); // 'HH:MM' -> unit_id
    for (const b of bookings) {
      // Normalize to HH:MM (DB may return 'HH:MM:SS')
      const key = String(b.start_time).slice(0, 5);
      bookedMap.set(key, b.unit_id);
    }

    // Build all slots and mark status
    const slots = buildSlots(
      String(facility.open_time),
      String(facility.close_time),
      facility.slot_minutes
    ).map((slot) => {
      const bookedUnit = bookedMap.get(slot.start);
      let status = 'open';
      if (bookedUnit) {
        status = bookedUnit === user.unit_id ? 'mine' : 'booked';
      }
      return { start: slot.start, end: slot.end, status };
    });

    return success(res, {
      facility: {
        id: facility.id,
        name: facility.name,
        sport: facility.sport,
        slotMinutes: facility.slot_minutes,
      },
      date,
      slots,
    });
  } catch (err) {
    console.error('GET /facilities/:id/availability error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// POST /facilities/:id/book
// ---------------------------------------------------------------------------
router.post('/facilities/:id/book', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const facilityId = req.params.id;

    // Validate body
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { date, start } = parsed.data;

    // Load facility
    const facility = await queryOne(
      `SELECT id, name, sport, open_time, close_time, slot_minutes
       FROM facilities
       WHERE id = $1 AND community_id = $2 AND is_active = TRUE`,
      [facilityId, user.community_id]
    );
    if (!facility) {
      return error(res, 'Facility not found', 404);
    }

    // Validate slot
    const slots = buildSlots(String(facility.open_time), String(facility.close_time), facility.slot_minutes);
    const matchedSlot = slots.find((s) => s.start === start);
    if (!matchedSlot) {
      return error(res, 'Invalid slot', 400);
    }
    const end = matchedSlot.end;

    // Window check: today .. today+7 (inclusive)
    const today = new Date().toISOString().slice(0, 10);
    const maxDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    if (date < today) {
      return error(res, 'Date in the past', 400);
    }
    if (date > maxDate) {
      return error(res, 'Outside booking window', 400);
    }

    // Conflict check: existing booked slot for this facility+date+start
    const slotConflict = await queryOne(
      `SELECT id FROM facility_bookings
       WHERE facility_id = $1 AND booking_date = $2 AND start_time = $3 AND status = 'booked'`,
      [facilityId, date, start]
    );
    if (slotConflict) {
      return error(res, 'Slot already booked', 409);
    }

    // One-per-sport-per-day-per-unit: check if this unit already has a booking for this sport on this date
    const sportConflict = await queryOne(
      `SELECT fb.id FROM facility_bookings fb
       JOIN facilities f ON f.id = fb.facility_id
       WHERE fb.unit_id = $1
         AND fb.booking_date = $2
         AND f.sport = $3
         AND fb.status = 'booked'`,
      [user.unit_id, date, facility.sport]
    );
    if (sportConflict) {
      return error(res, 'You already have a slot for this sport today', 409);
    }

    // Insert booking — wrap for unique-violation race condition
    let booking;
    try {
      booking = await queryOne(
        `INSERT INTO facility_bookings
           (community_id, facility_id, unit_id, resident_id, booking_date, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'booked')
         RETURNING id, facility_id, booking_date::text AS booking_date, start_time, end_time`,
        [user.community_id, facilityId, user.unit_id, user.sub, date, start, end]
      );
    } catch (dbErr) {
      // Unique-violation code: 23505
      if (dbErr.code === '23505') {
        return error(res, 'Slot already booked', 409);
      }
      throw dbErr;
    }

    return success(res, {
      id: booking.id,
      facilityId: booking.facility_id,
      date: booking.booking_date,
      start: String(booking.start_time).slice(0, 5),
      end: String(booking.end_time).slice(0, 5),
      status: 'booked',
    }, 201);
  } catch (err) {
    console.error('POST /facilities/:id/book error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /facilities/bookings/:id — cancel a booking
// ---------------------------------------------------------------------------
router.delete('/facilities/bookings/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const bookingId = req.params.id;

    // Load booking — must belong to this unit and be booked
    const booking = await queryOne(
      `SELECT id, booking_date::text AS booking_date, start_time
       FROM facility_bookings
       WHERE id = $1 AND unit_id = $2 AND status = 'booked'`,
      [bookingId, user.unit_id]
    );
    if (!booking) {
      return error(res, 'Booking not found', 404);
    }

    // Cutoff: cannot cancel if less than 1 hour from the slot start
    const startStr = String(booking.start_time).slice(0, 5); // 'HH:MM'
    const slotDateTime = new Date(`${booking.booking_date}T${startStr}:00`);
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (slotDateTime < oneHourFromNow) {
      return error(res, 'Too late to cancel', 409);
    }

    // Cancel
    await query(
      `UPDATE facility_bookings SET status = 'cancelled' WHERE id = $1`,
      [bookingId]
    );

    return success(res, { cancelled: true });
  } catch (err) {
    console.error('DELETE /facilities/bookings/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
