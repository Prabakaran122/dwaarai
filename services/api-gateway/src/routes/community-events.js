import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import pool from '../db/pool.js';

const router = Router();

const CATEGORIES = ['general', 'sports', 'festival', 'meeting', 'kids'];

// `filter` is the new BRD-driven filter chip param. `scope` is the OLD param
// the shipped Basera app already sends (scope=upcoming|past) — it must keep
// working byte-for-byte. When `filter` is absent, behaviour is governed by
// `scope` exactly as before this change.
const FILTERS = ['all', 'upcoming', 'stalls', 'donations', 'past'];

const createSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  location: z.string().max(160).optional(),
  category: z.enum(['general', 'sports', 'festival', 'meeting', 'kids']).optional().default('general'),
  startsAt: z.string(),
  endsAt: z.string().optional(),
});

const rsvpSchema = z.object({
  status: z.enum(['going', 'maybe', 'no']),
});

function shapeEvent(e) {
  return {
    id: e.id,
    title: e.title,
    description: e.description || null,
    location: e.location || null,
    category: e.category,
    startsAt: e.starts_at,
    endsAt: e.ends_at || null,
    authorName: e.author_name || null,
    goingCount: typeof e.going_count === 'number' ? e.going_count : Number(e.going_count || 0),
    myRsvp: e.my_rsvp || null,
    hasStalls: !!e.has_stalls,
    hasDonations: !!e.has_donations,
    isFeatured: !!e.is_featured,
    coverUrl: e.cover_path || null,
    stallsAvailable: typeof e.stalls_available === 'number' ? e.stalls_available : Number(e.stalls_available || 0),
    // `is_past` is only selected by the listing queries below (not by the
    // single-event / create paths); its absence means "not known to be past",
    // so default to bookable.
    bookable: e.is_past === true ? false : true,
  };
}

// Common projection shared by every listing query below. Extends the original
// columns with the commerce fields from migration 041 — `stalls_available`
// mirrors the exact predicate `uniq_live_booking_per_stall` enforces (a stall
// counts as available only if it has no non-released booking), so the
// `filter=stalls` chip and the actual booking guarantee never disagree.
const LIST_SELECT = `
  SELECT e.id, e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.author_name,
         e.has_stalls, e.has_donations, e.is_featured, e.cover_path,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going_count,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.resident_id = $2) AS my_rsvp,
         (SELECT COUNT(*) FROM event_stalls es
            WHERE es.event_id = e.id AND es.is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM stall_bookings sb WHERE sb.stall_id = es.id AND sb.status <> 'released'
              ))::int AS stalls_available,
         (e.starts_at < NOW()) AS is_past
    FROM events e`;

const TIME_PREDICATE = {
  upcoming: 'AND e.starts_at >= NOW()',
  past: 'AND e.starts_at < NOW()',
  all: '',
};

const EXTRA_PREDICATE = {
  // Not merely has_stalls = true — an event whose stalls are all booked must
  // not appear under a filter a user chose specifically to book one.
  stalls: `AND e.has_stalls = true AND EXISTS (
              SELECT 1 FROM event_stalls es
               WHERE es.event_id = e.id AND es.is_active = true
                 AND NOT EXISTS (
                   SELECT 1 FROM stall_bookings sb WHERE sb.stall_id = es.id AND sb.status <> 'released'
                 )
            )`,
  donations: 'AND e.has_donations = true',
  none: '',
};

function buildListSql(timeMode, extraMode) {
  const order = timeMode === 'past' ? 'DESC' : 'ASC';
  return `${LIST_SELECT}
   WHERE e.community_id = $1 AND e.is_cancelled = false
   ${TIME_PREDICATE[timeMode]}
   ${EXTRA_PREDICATE[extraMode]}
   ORDER BY e.starts_at ${order} LIMIT 100`;
}

const SINGLE_SQL = `
  SELECT e.id, e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.author_name,
         e.has_stalls, e.has_donations, e.is_featured, e.cover_path,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going_count,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.resident_id = $2) AS my_rsvp,
         (SELECT COUNT(*) FROM event_stalls es
            WHERE es.event_id = e.id AND es.is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM stall_bookings sb WHERE sb.stall_id = es.id AND sb.status <> 'released'
              ))::int AS stalls_available,
         (e.starts_at < NOW()) AS is_past
    FROM events e
   WHERE e.id = $3 AND e.community_id = $1 AND e.is_cancelled = false`;

// -- GET /community-events?scope=upcoming|past&filter=all|upcoming|stalls|donations|past --

router.get('/community-events', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    // Admin tokens carry `admins.id` as `sub`, a different id space from
    // `residents.id` — never pass it into the my_rsvp lookup, or an admin
    // could (in principle) collide with an unrelated resident's RSVP row.
    // An admin has no RSVP of their own, so this is always null for them.
    const sub = isAdminUser(req.user) ? null : req.user.sub;

    const filter = req.query.filter;
    if (filter !== undefined && !FILTERS.includes(filter)) {
      return error(res, 'Invalid filter', 400);
    }

    let timeMode;
    let extraMode = 'none';

    if (filter) {
      switch (filter) {
        case 'all':
          timeMode = 'all';
          break;
        case 'upcoming':
          timeMode = 'upcoming';
          break;
        case 'past':
          timeMode = 'past';
          break;
        case 'stalls':
          timeMode = 'upcoming';
          extraMode = 'stalls';
          break;
        case 'donations':
          timeMode = 'upcoming';
          extraMode = 'donations';
          break;
      }
    } else {
      // No `filter` present: preserve the legacy `scope` contract exactly.
      timeMode = req.query.scope === 'past' ? 'past' : 'upcoming';
    }

    const sql = buildListSql(timeMode, extraMode);
    const rows = await queryRows(sql, [community_id, sub]);
    return success(res, rows.map(shapeEvent));
  } catch (err) {
    console.error('GET /community-events error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /community-events --------------------------------------------------

router.post('/community-events', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { title, description, location, category, startsAt, endsAt } = parsed.data;
    const { community_id, sub, name } = req.user;

    // Validate startsAt is a valid date
    const startsDate = new Date(startsAt);
    if (isNaN(startsDate.getTime())) {
      return error(res, 'startsAt must be a valid ISO datetime', 400);
    }

    let endsDate = null;
    if (endsAt) {
      endsDate = new Date(endsAt);
      if (isNaN(endsDate.getTime())) {
        return error(res, 'endsAt must be a valid ISO datetime', 400);
      }
    }

    const authorName = name || 'Resident';

    const ev = await queryOne(
      `INSERT INTO events
         (community_id, created_by, author_name, title, description, location, category, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, description, location, category, starts_at, ends_at, author_name`,
      [community_id, sub, authorName, title, description || null, location || null, category, startsDate.toISOString(), endsDate ? endsDate.toISOString() : null]
    );

    return success(res, { ...shapeEvent(ev), goingCount: 0, myRsvp: null }, 201);
  } catch (err) {
    console.error('POST /community-events error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /community-events/:id -----------------------------------------------

router.get('/community-events/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    const sub = isAdminUser(req.user) ? null : req.user.sub;
    const ev = await queryOne(SINGLE_SQL, [community_id, sub, req.params.id]);
    if (!ev) {
      return error(res, 'Event not found', 404);
    }
    return success(res, shapeEvent(ev));
  } catch (err) {
    console.error('GET /community-events/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /community-events/:id/rsvp -----------------------------------------

router.post('/community-events/:id/rsvp', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = rsvpSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { community_id, sub } = req.user;
    const eventId = req.params.id;
    const { status } = parsed.data;

    // Verify event exists in caller's community
    const ev = await queryOne(
      'SELECT id FROM events WHERE id = $1 AND community_id = $2 AND is_cancelled = false',
      [eventId, community_id]
    );
    if (!ev) {
      return error(res, 'Event not found', 404);
    }

    await query(
      `INSERT INTO event_rsvps (event_id, resident_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, resident_id) DO UPDATE SET status = EXCLUDED.status`,
      [eventId, sub, status]
    );

    return success(res, { eventId, status });
  } catch (err) {
    console.error('POST /community-events/:id/rsvp error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/events/:id/feature -------------------------------------------
//
// `uniq_featured_event_per_community` (migration 041) is a PARTIAL unique
// index — at most one is_featured = true row per community. A naive
// `UPDATE events SET is_featured = true WHERE id = $1` therefore raises 23505
// the instant a different event is already featured. This handler cooperates
// with that constraint instead of fighting it: within one transaction it
// clears whichever event currently holds the flag, THEN sets it on the
// requested event, so the index never sees two true rows at once. The 23505
// catch below is belt-and-suspenders for a genuine concurrent race between
// two admins featuring different events at once — it becomes a 409, not a 500.
router.post('/admin/events/:id/feature', authenticateJWT(['admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isAdminUser(req.user)) {
      return error(res, 'Insufficient permissions', 403);
    }

    const { community_id } = req.user;
    const eventId = req.params.id;

    const evResult = await client.query(
      'SELECT id FROM events WHERE id = $1 AND community_id = $2 AND is_cancelled = false',
      [eventId, community_id]
    );
    if (!evResult.rows.length) {
      return error(res, 'Event not found', 404);
    }

    await client.query('BEGIN');
    try {
      // Clear first — whatever else in this community is currently featured.
      await client.query(
        'UPDATE events SET is_featured = false WHERE community_id = $1 AND is_featured = true',
        [community_id]
      );
      // Then set the requested event.
      await client.query(
        'UPDATE events SET is_featured = true WHERE id = $1 AND community_id = $2',
        [eventId, community_id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && err.code === '23505') {
        return error(res, 'Another event was just featured — please retry', 409);
      }
      throw err;
    }

    return success(res, { eventId, isFeatured: true });
  } catch (err) {
    console.error('POST /admin/events/:id/feature error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

export default router;
