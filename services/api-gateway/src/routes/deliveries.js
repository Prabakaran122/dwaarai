import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';
import { sendNotification } from '../lib/fcm.js';

const router = Router();

const createSchema = z.object({
  unit_number: z.string().min(1),
  company: z.string().min(1).max(40),
  note: z.string().max(500).optional(),
});

const statusSchema = z.object({
  status: z.enum(['delivered', 'left_at_gate']),
});

function shape(d) {
  return {
    id: d.id,
    company: d.company,
    note: d.note || null,
    status: d.status,
    unit_id: d.unit_id,
    unit_number: d.unit_number || null,
    logged_by_name: d.logged_by_name || null,
    created_at: d.created_at,
    resolved_at: d.resolved_at || null,
  };
}

// -- POST /deliveries (guard) — log a courier arrival ------------------------

router.post('/deliveries', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const user = req.user;
    const { unit_number, company, note } = parsed.data;

    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [user.community_id, unit_number]
    );
    if (!unit) {
      return error(res, `Unit ${unit_number} not found`, 404);
    }

    const delivery = await queryOne(
      `INSERT INTO deliveries (community_id, gate_id, unit_id, company, note, logged_by, logged_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user.community_id, user.gate_id || null, unit.id, company, note || null, user.sub, user.name || null]
    );

    // Notify the unit's residents (push) + live update to the community room.
    const residents = await queryRows(
      'SELECT fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
      [unit.id]
    );
    for (const r of residents) {
      sendNotification(r.fcm_token, 'Delivery at the gate', `${company} delivery is at the gate.`, {
        type: 'delivery', delivery_id: delivery.id,
      }).catch((e) => console.error('[Push] delivery alert failed:', e.message));
    }

    broadcast(user.community_id, 'delivery:arrived', { ...shape(delivery), unit_number });

    return success(res, { ...shape(delivery), unit_number, notified: residents.length }, 201);
  } catch (err) {
    console.error('POST /deliveries error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /deliveries/active (guard) ------------------------------------------

router.get('/deliveries/active', authenticateJWT(['guard']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT d.*, u.unit_number
         FROM deliveries d
         JOIN units u ON d.unit_id = u.id
        WHERE d.community_id = $1 AND d.status = 'waiting'
        ORDER BY d.created_at DESC`,
      [req.user.community_id]
    );
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /deliveries/active error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /deliveries/:id/status (guard) -------------------------------------

router.post('/deliveries/:id/status', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, "status must be 'delivered' or 'left_at_gate'", 400);
    }
    const user = req.user;
    const existing = await queryOne(
      "SELECT id FROM deliveries WHERE id = $1 AND community_id = $2 AND status = 'waiting'",
      [req.params.id, user.community_id]
    );
    if (!existing) {
      return error(res, 'Active delivery not found', 404);
    }
    await query(
      'UPDATE deliveries SET status = $1, resolved_at = NOW() WHERE id = $2',
      [parsed.data.status, existing.id]
    );
    broadcast(user.community_id, 'delivery:updated', { id: existing.id, status: parsed.data.status });
    return success(res, { id: existing.id, status: parsed.data.status });
  } catch (err) {
    console.error('POST /deliveries/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /deliveries (resident) — my unit's parcels --------------------------

router.get('/deliveries', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const statusFilter = req.query.status || null;
    if (statusFilter && !['waiting', 'delivered', 'left_at_gate'].includes(statusFilter)) {
      return error(res, 'Invalid status filter', 400);
    }
    let sql = 'SELECT * FROM deliveries WHERE community_id = $1 AND unit_id = $2';
    const params = [community_id, unit_id];
    if (statusFilter) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(statusFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const rows = await queryRows(sql, params);
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /deliveries error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /deliveries/:id/collect (resident) — mark my parcel collected ------

router.post('/deliveries/:id/collect', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const d = await queryOne(
      'SELECT id, unit_id, status FROM deliveries WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!d) return error(res, 'Delivery not found', 404);
    if (d.unit_id !== unit_id) return error(res, 'Not your delivery', 403);
    if (d.status !== 'waiting') return error(res, 'Delivery already resolved', 409);

    // Atomic guard: only one concurrent request can flip a 'waiting' row to 'delivered'.
    const upd = await query(
      "UPDATE deliveries SET status = 'delivered', resolved_at = NOW() WHERE id = $1 AND status = 'waiting'",
      [d.id]
    );
    if (!upd.rowCount) return error(res, 'Delivery already resolved', 409); // lost a concurrent race
    broadcast(community_id, 'delivery:updated', { id: d.id, status: 'delivered' });
    return success(res, { id: d.id, status: 'delivered' });
  } catch (err) {
    console.error('POST /deliveries/:id/collect error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
