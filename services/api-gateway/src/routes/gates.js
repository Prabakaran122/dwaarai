import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, authenticateDevice } from '../middleware/auth.js';
import { publishGateCommand } from '../mqtt.js';
import { broadcast } from '../websocket.js';

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
      'SELECT id, community_id, name FROM gates WHERE id = $1 AND community_id = $2',
      [gateId, communityId]
    );

    if (!gate) {
      return error(res, 'Gate not found', 404);
    }

    const eventId = uuidv4();
    const ttl = Math.floor(Date.now() / 1000) + (parseInt(process.env.MQTT_COMMAND_TTL_SECONDS) || 30);

    // Record the event
    await query(
      `INSERT INTO gate_events
         (id, community_id, gate_id, detection_method, raw_value, access_decision, event_ts)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [eventId, communityId, gateId, 'manual', parsed.data.action, 'allow']
    );

    // Publish MQTT command to edge node
    try {
      await publishGateCommand(communityId, gateId, {
        event_id: eventId,
        action: parsed.data.action,
        plate: parsed.data.plate || null,
        unit_number: parsed.data.unit_number || null,
        resident_name: parsed.data.resident_name || null,
        ttl,
        ts: Date.now() / 1000,
      });
    } catch (mqttErr) {
      console.error('MQTT publish failed (event still recorded):', mqttErr);
    }

    broadcast(communityId, 'gate:command', {
      gateId,
      gateName: gate.name || null,
      action: parsed.data.action,
      initiatedBy: user.name,
      role: user.role,
      plate: parsed.data.plate || null,
      residentName: parsed.data.resident_name || null,
      ts: new Date().toISOString(),
    });

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

    // Verify device token matches the claimed gate/community
    if (gate_id !== req.device.gate_id || community_id !== req.device.community_id) {
      return error(res, 'Device token does not match gate_id/community_id', 403);
    }

    await query(
      'UPDATE gates SET last_seen = NOW(), status = $1 WHERE id = $2 AND community_id = $3',
      [status, gate_id, community_id]
    );

    const gate = await queryOne(
      'SELECT name FROM gates WHERE id = $1 AND community_id = $2',
      [gate_id, community_id]
    );
    broadcast(community_id, 'gate:status', {
      gateId: gate_id,
      gateName: gate?.name || null,
      status,
      lastSeen: new Date().toISOString(),
      ts: new Date().toISOString(),
    });

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

    // Verify all events belong to this device's community/gate
    const deviceCommunity = req.device.community_id;
    const deviceGate = req.device.gate_id;
    for (const evt of events) {
      if (evt.community_id !== deviceCommunity || evt.gate_id !== deviceGate) {
        return error(res, 'Event community_id/gate_id does not match device token', 403);
      }
    }

    // Look up gate name for broadcast
    const gate = await queryOne(
      'SELECT name FROM gates WHERE id = $1 AND community_id = $2',
      [deviceGate, deviceCommunity]
    );

    for (const evt of events) {
      const eventId = uuidv4();
      await query(
        `INSERT INTO gate_events
           (id, community_id, gate_id, detection_method, raw_value,
            matched_vehicle_id, matched_pass_id, matched_unit_id,
            matched_unit_number, resident_name, access_decision,
            deny_reason, anpr_confidence, snapshot_s3_key,
            processing_ms, is_offline_event, synced_at, event_ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,NOW(),$16)`,
        [
          eventId,
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
      broadcast(evt.community_id, 'gate:event', {
        id: eventId,
        gateId: evt.gate_id,
        gateName: gate?.name || null,
        detectionMethod: evt.detection_method,
        rawValue: evt.raw_value || null,
        accessDecision: evt.access_decision,
        denyReason: evt.deny_reason || null,
        matchedUnitNumber: evt.matched_unit_number || null,
        residentName: evt.resident_name || null,
        anprConfidence: evt.anpr_confidence ?? null,
        eventTs: evt.event_ts,
      });
    }

    return success(res, { inserted, total: events.length });
  } catch (err) {
    console.error('POST /events/sync error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
