import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, queryRows } from './db.js';
import { publishCommand } from './mqtt-publisher.js';

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

// -- Zod schemas -------------------------------------------------------------

const commandSchema = z.object({
  action: z.enum(['open', 'close']),
  plate: z.string().max(20).optional(),
  rfid_hash: z.string().max(128).optional(),
  unit_id: z.string().uuid().optional(),
  unit_number: z.string().max(30).optional(),
  resident_name: z.string().max(200).optional(),
});

const heartbeatSchema = z.object({
  gate_id: z.string().min(1),
  community_id: z.string().uuid(),
  status: z.enum(['online', 'offline', 'degraded']),
  is_open: z.boolean(),
  queue_depth: z.number().int().min(0),
  uptime_s: z.number().min(0),
  ts: z.number(),
});

const eventSyncItemSchema = z.object({
  community_id: z.string().uuid(),
  gate_id: z.string().uuid(),
  detection_method: z.string().min(1).max(10),
  raw_value: z.string().max(100).optional(),
  matched_vehicle_id: z.string().uuid().optional().nullable(),
  matched_pass_id: z.string().uuid().optional().nullable(),
  matched_unit_id: z.string().uuid().optional().nullable(),
  matched_unit_number: z.string().max(30).optional().nullable(),
  resident_name: z.string().max(200).optional().nullable(),
  access_decision: z.enum(['allow', 'deny', 'override']),
  deny_reason: z.string().max(100).optional().nullable(),
  anpr_confidence: z.number().min(0).max(1).optional().nullable(),
  snapshot_s3_key: z.string().optional().nullable(),
  processing_ms: z.number().int().optional().nullable(),
  event_ts: z.string().datetime(),
});

const eventSyncSchema = z.object({
  events: z.array(eventSyncItemSchema).min(1).max(500),
});

// -- GET /gates  (JWT admin) -------------------------------------------------

router.get('/gates', async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const gates = await queryRows(
      'SELECT * FROM gates WHERE community_id = $1 ORDER BY name',
      [user.community_id]
    );

    return success(res, { gates });
  } catch (err) {
    console.error('GET /gates error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /gates/:id/status  (JWT any) ----------------------------------------

router.get('/gates/:id/status', async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return error(res, 'Authentication required', 401);
    }

    const gate = await queryOne(
      'SELECT id, name, status, last_seen, is_active FROM gates WHERE id = $1 AND community_id = $2',
      [req.params.id, user.community_id]
    );

    if (!gate) {
      return error(res, 'Gate not found', 404);
    }

    return success(res, {
      status: gate.status,
      is_open: gate.status === 'online',
      last_seen: gate.last_seen,
      queue_depth: 0, // live value comes from heartbeat
    });
  } catch (err) {
    console.error('GET /gates/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /gates/:id/command  (JWT admin) ------------------------------------

router.post('/gates/:id/command', async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const gateId = req.params.id;
    const communityId = user.community_id;

    // Verify gate exists
    const gate = await queryOne(
      'SELECT id, community_id FROM gates WHERE id = $1 AND community_id = $2',
      [gateId, communityId]
    );

    if (!gate) {
      return error(res, 'Gate not found', 404);
    }

    // Publish MQTT command
    const payload = publishCommand(communityId, gateId, {
      action: parsed.data.action,
      plate: parsed.data.plate || null,
      rfid_hash: parsed.data.rfid_hash || null,
      method: 'manual',
      unit_id: parsed.data.unit_id || null,
      unit_number: parsed.data.unit_number || null,
      resident_name: parsed.data.resident_name || null,
    });

    // Record the event
    await query(
      `INSERT INTO gate_events
         (id, community_id, gate_id, detection_method, raw_value, access_decision, event_ts)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [payload.event_id, communityId, gateId, 'manual', parsed.data.action, 'allow']
    );

    return success(res, { event_id: payload.event_id, topic: `cg/${communityId}/gates/${gateId}/commands`, payload }, 201);
  } catch (err) {
    console.error('POST /gates/:id/command error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /heartbeat  (Device token) ----------------------------------------

router.post('/heartbeat', async (req, res) => {
  try {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { gate_id, community_id, status, is_open, queue_depth } = parsed.data;

    await query(
      `UPDATE gates SET last_seen = NOW(), status = $1 WHERE id = $2 AND community_id = $3`,
      [status, gate_id, community_id]
    );

    // Return minimal config delta (placeholder for future config sync)
    return success(res, { ack: true, config_delta: null });
  } catch (err) {
    console.error('POST /heartbeat error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /events/sync  (Device token) --------------------------------------

router.post('/events/sync', async (req, res) => {
  try {
    const parsed = eventSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { events } = parsed.data;
    let inserted = 0;

    // Batch insert using a single transaction
    const client = (await import('./db.js')).default;
    const conn = await client.connect();
    try {
      await conn.query('BEGIN');

      for (const evt of events) {
        await conn.query(
          `INSERT INTO gate_events
             (community_id, gate_id, detection_method, raw_value,
              matched_vehicle_id, matched_pass_id, matched_unit_id,
              matched_unit_number, resident_name, access_decision,
              deny_reason, anpr_confidence, snapshot_s3_key,
              processing_ms, is_offline_event, synced_at, event_ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,NOW(),$15)`,
          [
            evt.community_id, evt.gate_id, evt.detection_method,
            evt.raw_value || null,
            evt.matched_vehicle_id || null, evt.matched_pass_id || null,
            evt.matched_unit_id || null, evt.matched_unit_number || null,
            evt.resident_name || null, evt.access_decision,
            evt.deny_reason || null, evt.anpr_confidence ?? null,
            evt.snapshot_s3_key || null, evt.processing_ms ?? null,
            evt.event_ts,
          ]
        );
        inserted++;
      }

      await conn.query('COMMIT');
    } catch (txErr) {
      await conn.query('ROLLBACK');
      throw txErr;
    } finally {
      conn.release();
    }

    return success(res, { inserted, total: events.length });
  } catch (err) {
    console.error('POST /events/sync error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /events  (JWT admin) ------------------------------------------------

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
    const methodFilter = req.query.method || null;
    const decisionFilter = req.query.decision || null;
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

    return success(res, { events: data, nextCursor });
  } catch (err) {
    console.error('GET /events error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
