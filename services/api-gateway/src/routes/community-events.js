import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const CATEGORIES = ['general', 'sports', 'festival', 'meeting', 'kids'];

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
  };
}

const LIST_SQL_UPCOMING = `
  SELECT e.id, e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.author_name,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going_count,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.resident_id = $2) AS my_rsvp
    FROM events e
   WHERE e.community_id = $1 AND e.is_cancelled = false AND e.starts_at >= NOW()
   ORDER BY e.starts_at ASC LIMIT 100`;

const LIST_SQL_PAST = `
  SELECT e.id, e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.author_name,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going_count,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.resident_id = $2) AS my_rsvp
    FROM events e
   WHERE e.community_id = $1 AND e.is_cancelled = false AND e.starts_at < NOW()
   ORDER BY e.starts_at DESC LIMIT 100`;

const SINGLE_SQL = `
  SELECT e.id, e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.author_name,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going_count,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.resident_id = $2) AS my_rsvp
    FROM events e
   WHERE e.id = $3 AND e.community_id = $1 AND e.is_cancelled = false`;

// -- GET /community-events?scope=upcoming|past --------------------------------

router.get('/community-events', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;
    const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
    const sql = scope === 'past' ? LIST_SQL_PAST : LIST_SQL_UPCOMING;
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

router.get('/community-events/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;
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

export default router;
