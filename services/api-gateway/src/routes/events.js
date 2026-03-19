import { Router } from 'express';
import { queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// -- GET /events (JWT admin) -------------------------------------------------

router.get('/events', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const communityId = user.community_id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const cursor = req.query.cursor || null;
    const gateFilter = req.query.gate_id || null;
    const methodFilter = req.query.detection_method || null;
    const decisionFilter = req.query.access_decision || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const plateFilter = req.query.plate || null;

    let sql = 'SELECT * FROM gate_events WHERE community_id = $1';
    const params = [communityId];

    if (gateFilter) {
      sql += ` AND gate_id = $${params.length + 1}`;
      params.push(gateFilter);
    }
    if (methodFilter) {
      sql += ` AND detection_method = $${params.length + 1}`;
      params.push(methodFilter);
    }
    if (decisionFilter) {
      sql += ` AND access_decision = $${params.length + 1}`;
      params.push(decisionFilter);
    }
    if (dateFrom) {
      sql += ` AND event_ts >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND event_ts <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (plateFilter) {
      sql += ` AND raw_value ILIKE $${params.length + 1}`;
      params.push(`%${plateFilter}%`);
    }
    if (cursor) {
      sql += ` AND event_ts < $${params.length + 1}`;
      params.push(cursor);
    }

    sql += ` ORDER BY event_ts DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].event_ts.toISOString() : null;

    return success(res, { events: data, cursor: nextCursor, hasMore });
  } catch (err) {
    console.error('GET /events error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /reports/daily (JWT admin) ------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/reports/daily', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const date = req.query.date;
    if (!date || !DATE_RE.test(date)) {
      return error(res, 'Missing or invalid date parameter. Expected format: YYYY-MM-DD', 400);
    }

    const parsed = new Date(date + 'T00:00:00Z');
    if (isNaN(parsed.getTime())) {
      return error(res, 'Invalid date value', 400);
    }

    const communityId = user.community_id;
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const events = await queryRows(
      `SELECT * FROM gate_events
       WHERE community_id = $1 AND event_ts >= $2 AND event_ts <= $3
       ORDER BY event_ts ASC`,
      [communityId, dayStart, dayEnd]
    );

    // Return JSON summary for the MVP (PDF generation is in the audit-service)
    const summary = {
      date,
      community_id: communityId,
      total_events: events.length,
      allowed: events.filter(e => e.access_decision === 'allow').length,
      denied: events.filter(e => e.access_decision === 'deny').length,
      guard_review: events.filter(e => e.access_decision === 'guard_review').length,
      events,
    };

    return success(res, summary);
  } catch (err) {
    console.error('GET /reports/daily error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
