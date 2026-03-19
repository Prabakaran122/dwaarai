import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, authenticateDevice } from '../middleware/auth.js';

const router = Router();

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

// -- GET /gates (JWT admin) --------------------------------------------------

router.get('/gates', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
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

// -- GET /gates/:id/status (JWT any) -----------------------------------------

router.get('/gates/:id/status', authenticateJWT(), async (req, res) => {
  try {
    const user = req.user;
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
      queue_depth: 0,
    });
  } catch (err) {
    console.error('GET /gates/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /gates/:id/command (JWT admin) -------------------------------------

router.post('/gates/:id/command', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const gateId = req.params.id;
    const communityId = user.community_id;

    const gate = await queryOne(
      'SELECT id, community_id FROM gates WHERE id = $1 AND community_id = $2',
      [gateId, communityId]
    );

    if (!gate) {
      return error(res, 'Gate not found', 404);
    }

    const eventId = uuidv4();

    // Record the event (MQTT publishing is skipped in the gateway; edge devices poll or use websockets)
    await query(
      `INSERT INTO gate_events
         (id, community_id, gate_id, detection_method, raw_value, access_decision, event_ts)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [eventId, communityId, gateId, 'manual', parsed.data.action, 'allow']
    );

    return success(res, {
      event_id: eventId,
      gate_id: gateId,
      action: parsed.data.action,
    }, 201);
  } catch (err) {
    console.error('POST /gates/:id/command error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /heartbeat (device token) ------------------------------------------

router.post('/heartbeat', authenticateDevice, async (req, res) => {
  try {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { gate_id, community_id, status } = parsed.data;

    await query(
      'UPDATE gates SET last_seen = NOW(), status = $1 WHERE id = $2 AND community_id = $3',
      [status, gate_id, community_id]
    );

    return success(res, { ack: true, config_delta: null });
  } catch (err) {
    console.error('POST /heartbeat error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /events/sync (device token) ----------------------------------------

router.post('/events/sync', authenticateDevice, async (req, res) => {
  try {
    const parsed = eventSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { events } = parsed.data;
    let inserted = 0;

    for (const evt of events) {
      await query(
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

    return success(res, { inserted, total: events.length });
  } catch (err) {
    console.error('POST /events/sync error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
