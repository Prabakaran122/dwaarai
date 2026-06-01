import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';

const router = Router();

const TYPES = ['medical', 'fire', 'security', 'other'];

const raiseSchema = z.object({
  type: z.enum(['medical', 'fire', 'security', 'other']),
  note: z.string().max(500).optional(),
});

function shape(a) {
  return {
    id: a.id,
    type: a.type,
    note: a.note || null,
    status: a.status,
    gate_id: a.gate_id || null,
    raised_by_name: a.raised_by_name || null,
    created_at: a.created_at,
    resolved_at: a.resolved_at || null,
  };
}

// -- POST /sos (guard) — raise an emergency alert -----------------------------

router.post('/sos', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = raiseSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, `type must be one of: ${TYPES.join(', ')}`, 400);
    }
    const user = req.user;
    const alert = await queryOne(
      `INSERT INTO sos_alerts (community_id, gate_id, raised_by, raised_by_name, type, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.community_id, user.gate_id || null, user.sub, user.name || null, parsed.data.type, parsed.data.note || null]
    );

    // Live alert to everyone in the community room (other guards, admin dashboards).
    broadcast(user.community_id, 'sos:alert', shape(alert));

    return success(res, shape(alert), 201);
  } catch (err) {
    console.error('POST /sos error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /sos/active (guard or admin) — active alerts for the community -------

router.get('/sos/active', authenticateJWT(['guard', 'admin']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT * FROM sos_alerts
        WHERE community_id = $1 AND status = 'active'
        ORDER BY created_at DESC`,
      [req.user.community_id]
    );
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /sos/active error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /sos/:id/resolve (guard or admin) ----------------------------------

router.post('/sos/:id/resolve', authenticateJWT(['guard', 'admin']), async (req, res) => {
  try {
    const user = req.user;
    const alert = await queryOne(
      "SELECT * FROM sos_alerts WHERE id = $1 AND community_id = $2 AND status = 'active'",
      [req.params.id, user.community_id]
    );
    if (!alert) {
      return error(res, 'Active alert not found', 404);
    }
    await query(
      "UPDATE sos_alerts SET status = 'resolved', resolved_at = NOW(), resolved_by = $1 WHERE id = $2",
      [user.sub, alert.id]
    );
    broadcast(user.community_id, 'sos:resolved', { id: alert.id });
    return success(res, { id: alert.id, status: 'resolved' });
  } catch (err) {
    console.error('POST /sos/:id/resolve error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
