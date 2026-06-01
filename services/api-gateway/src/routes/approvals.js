import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { sendApprovalRequest } from '../lib/fcm.js';
import { publishGateCommand } from '../mqtt.js';
import { broadcast } from '../websocket.js';

const router = Router();

const APPROVAL_TTL_MS = 60_000;

// In-memory expiry timers — cleared when a response arrives before timeout
const expiryTimers = new Map();

// -- Zod schemas -------------------------------------------------------------

const createSchema = z.object({
  unit_number: z.string().min(1).max(30),
  visitor_name: z.string().min(1).max(200),
  vehicle_plate: z.string().max(20).optional(),
  gate_id: z.string().uuid(),
});

const respondSchema = z.object({
  action: z.enum(['approve', 'deny']),
});

// -- Helper: auto-expire if past deadline ------------------------------------

async function autoExpireIfNeeded(approval) {
  if (approval.status === 'pending' && new Date(approval.expires_at) < new Date()) {
    const expired = await queryOne(
      `UPDATE approval_requests SET status = 'expired'
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [approval.id]
    );
    if (expired) {
      clearTimerFor(expired.id);
      broadcast(expired.community_id, 'approval:response', {
        approval_id: expired.id,
        status: 'expired',
        ts: new Date().toISOString(),
      });
      return expired;
    }
  }
  return approval;
}

function clearTimerFor(id) {
  const timer = expiryTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(id);
  }
}

// -- POST /approvals (guard JWT) ---------------------------------------------

router.post('/approvals', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { unit_number, visitor_name, vehicle_plate, gate_id } = parsed.data;
    const user = req.user;
    const community_id = user.community_id;

    // Look up unit
    const unit = await queryOne(
      'SELECT id, unit_number FROM units WHERE community_id = $1 AND unit_number = $2',
      [community_id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found', 404);
    }

    // Look up gate
    const gate = await queryOne(
      'SELECT id, name FROM gates WHERE id = $1 AND community_id = $2',
      [gate_id, community_id]
    );
    if (!gate) {
      return error(res, 'Gate not found', 404);
    }

    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);

    const approval = await queryOne(
      `INSERT INTO approval_requests
         (community_id, unit_id, gate_id, guard_id, visitor_name, vehicle_plate, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [community_id, unit.id, gate_id, user.sub, visitor_name, vehicle_plate || null, expiresAt]
    );

    // Send push to active residents in the unit who haven't opted out of
    // gate-approval alerts (notify_on_approval). The primary resident always
    // keeps this on, so a unit can never end up with nobody notified.
    const residents = await queryRows(
      'SELECT id, fcm_token, name FROM residents WHERE unit_id = $1 AND is_active = true AND notify_on_approval IS NOT FALSE',
      [unit.id]
    );

    for (const resident of residents) {
      if (resident.fcm_token) {
        sendApprovalRequest(resident.fcm_token, approval.id, visitor_name, gate.name, unit_number)
          .catch((err) => console.error(`[Push] Failed for resident ${resident.id}:`, err.message));
      }
    }

    // Broadcast WebSocket event
    broadcast(community_id, 'approval:waiting', {
      approval_id: approval.id,
      unit_number,
      visitor_name,
      vehicle_plate: vehicle_plate || null,
      gate_id,
      gate_name: gate.name,
      expires_at: expiresAt.toISOString(),
      ts: new Date().toISOString(),
    });

    // Start expiry timer
    const timer = setTimeout(async () => {
      expiryTimers.delete(approval.id);
      try {
        const expired = await queryOne(
          `UPDATE approval_requests SET status = 'expired'
           WHERE id = $1 AND status = 'pending' RETURNING *`,
          [approval.id]
        );
        if (expired) {
          broadcast(community_id, 'approval:response', {
            approval_id: expired.id,
            status: 'expired',
            ts: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(`[Approval] Timer expiry error for ${approval.id}:`, err.message);
      }
    }, APPROVAL_TTL_MS);

    expiryTimers.set(approval.id, timer);

    return success(res, approval, 201);
  } catch (err) {
    console.error('POST /approvals error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /approvals/:id/respond (resident JWT) ------------------------------

router.post('/approvals/:id/respond', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { action } = parsed.data;
    const approvalId = req.params.id;
    const user = req.user;

    // Safety-net: auto-expire if past deadline
    const existing = await queryOne(
      'SELECT * FROM approval_requests WHERE id = $1 AND community_id = $2',
      [approvalId, user.community_id]
    );
    if (!existing) {
      return error(res, 'Approval request not found', 404);
    }
    if (existing.status === 'pending' && new Date(existing.expires_at) < new Date()) {
      await autoExpireIfNeeded(existing);
      return error(res, 'Approval request has expired', 410);
    }

    const newStatus = action === 'approve' ? 'approved' : 'denied';

    // Atomic update — first response wins via WHERE status='pending'
    const updated = await queryOne(
      `UPDATE approval_requests
       SET status = $1, responded_by = $2, responded_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [newStatus, user.sub, approvalId]
    );

    if (!updated) {
      return error(res, 'Approval already responded to or expired', 409);
    }

    // Clear the expiry timer
    clearTimerFor(approvalId);

    // If approved, open the gate
    if (action === 'approve') {
      const eventId = uuidv4();
      const ttl = Math.floor(Date.now() / 1000) + (parseInt(process.env.MQTT_COMMAND_TTL_SECONDS) || 30);

      await query(
        `INSERT INTO gate_events
           (id, community_id, gate_id, detection_method, raw_value, access_decision, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [eventId, updated.community_id, updated.gate_id, 'approval', updated.visitor_name, 'allow']
      );

      try {
        await publishGateCommand(updated.community_id, updated.gate_id, {
          event_id: eventId,
          action: 'open',
          ttl,
          ts: Date.now() / 1000,
        });
      } catch (mqttErr) {
        console.error('MQTT publish failed (event still recorded):', mqttErr);
      }
    }

    // Broadcast result
    broadcast(updated.community_id, 'approval:response', {
      approval_id: updated.id,
      status: newStatus,
      responded_by: user.sub,
      responded_by_name: user.name || null,
      ts: new Date().toISOString(),
    });

    return success(res, updated);
  } catch (err) {
    console.error('POST /approvals/:id/respond error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /approvals/:id (guard or resident JWT) ------------------------------

router.get('/approvals/:id', authenticateJWT(['guard', 'resident']), async (req, res) => {
  try {
    const approvalId = req.params.id;
    const user = req.user;

    const approval = await queryOne(
      'SELECT * FROM approval_requests WHERE id = $1 AND community_id = $2',
      [approvalId, user.community_id]
    );

    if (!approval) {
      return error(res, 'Approval request not found', 404);
    }

    // Safety-net expiry check
    const result = await autoExpireIfNeeded(approval);

    return success(res, result);
  } catch (err) {
    console.error('GET /approvals/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
