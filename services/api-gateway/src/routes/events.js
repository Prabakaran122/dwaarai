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

    let sql = `SELECT ge.*, g.name AS gate_name
      FROM gate_events ge
      LEFT JOIN gates g ON ge.gate_id = g.id
      WHERE ge.community_id = $1`;
    const params = [communityId];

    if (gateFilter) {
      sql += ` AND ge.gate_id = $${params.length + 1}`;
      params.push(gateFilter);
    }
    if (methodFilter) {
      sql += ` AND ge.detection_method = $${params.length + 1}`;
      params.push(methodFilter);
    }
    if (decisionFilter) {
      sql += ` AND ge.access_decision = $${params.length + 1}`;
      params.push(decisionFilter);
    }
    if (dateFrom) {
      sql += ` AND ge.event_ts >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND ge.event_ts <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (plateFilter) {
      sql += ` AND ge.raw_value ILIKE $${params.length + 1}`;
      params.push(`%${plateFilter}%`);
    }
    if (cursor) {
      sql += ` AND ge.event_ts < $${params.length + 1}`;
      params.push(cursor);
    }

    sql += ` ORDER BY ge.event_ts DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const rawData = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? rawData[rawData.length - 1].event_ts.toISOString() : null;

    // Map DB columns to frontend-friendly field names
    const data = rawData.map(row => ({
      id: row.id,
      timestamp: row.event_ts,
      gate_name: row.gate_name || 'Unknown',
      method: row.detection_method,
      plate: row.raw_value || '',
      decision: row.access_decision,
      unit_number: row.matched_unit_number || '',
      resident_name: row.resident_name || '',
      confidence: row.anpr_confidence,
    }));

    return success(res, { events: data, cursor: nextCursor, hasMore });
  } catch (err) {
    console.error('GET /events error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /events/my-unit (JWT resident) --------------------------------------

router.get('/events/my-unit', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const methodFilter = req.query.detection_method || null;

    let sql = `SELECT ge.*, g.name AS gate_name
      FROM gate_events ge
      LEFT JOIN gates g ON ge.gate_id = g.id
      WHERE ge.community_id = $1
        AND ge.matched_unit_id = $2`;
    const params = [community_id, unit_id];

    if (dateFrom) {
      sql += ` AND ge.event_ts >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND ge.event_ts <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (methodFilter) {
      sql += ` AND ge.detection_method = $${params.length + 1}`;
      params.push(methodFilter);
    }
    if (cursor) {
      sql += ` AND ge.event_ts < $${params.length + 1}`;
      params.push(cursor);
    }

    sql += ` ORDER BY ge.event_ts DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const rawData = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? rawData[rawData.length - 1].event_ts.toISOString() : null;

    const data = rawData.map(row => ({
      id: row.id,
      timestamp: row.event_ts,
      gate_name: row.gate_name || 'Unknown',
      method: row.detection_method,
      plate: row.raw_value || '',
      decision: row.access_decision,
      direction: row.direction || 'entry',
      resident_name: row.resident_name || '',
      confidence: row.anpr_confidence,
    }));

    return success(res, data);
  } catch (err) {
    console.error('GET /events/my-unit error:', err);
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

// NOTE: GET /admin/dashboard/stats lived here and returned four bare counters.
// It is superseded by /admin/dashboard/summary (routes/dashboard.js), which
// returns those figures plus trends, hourly buckets and gate operations in one
// round trip. Nothing referenced it any more — portal, guard app and resident
// app were all checked — so it was removed rather than left to rot.

export default router;
