import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queryRows } from './db.js';
import { generateDailyReport } from './pdf-report.js';

const router = Router();

// -- Response helpers --------------------------------------------------------

function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

function error(res, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: { message, details },
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

// -- GET /events  (JWT admin) — paginated event log with filters -------------

router.get('/events', async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

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

// -- GET /reports/daily  (JWT admin) — PDF daily report ----------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/reports/daily', async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const date = req.query.date;
    if (!date || !DATE_RE.test(date)) {
      return error(res, 'Missing or invalid date parameter. Expected format: YYYY-MM-DD', 400);
    }

    // Validate the date is a real calendar date
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

    const pdfStream = generateDailyReport(date, events);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${date}.pdf"`);

    pdfStream.pipe(res);
  } catch (err) {
    console.error('GET /reports/daily error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
