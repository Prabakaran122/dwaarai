import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';

const router = Router();

const createSchema = z.object({
  type: z.string().min(1).max(50),
  description: z.string().max(2000).optional(),
  // Guard app sends camelCase gateId; accept either, fall back to the token's gate.
  gateId: z.string().optional(),
  gate_id: z.string().optional(),
});

function shape(i) {
  return {
    id: i.id,
    type: i.type,
    description: i.description || null,
    status: i.status,
    gate_id: i.gate_id || null,
    reported_by_name: i.reported_by_name || null,
    created_at: i.created_at,
    reviewed_at: i.reviewed_at || null,
  };
}

// -- POST /incidents (guard) — file an incident ------------------------------

router.post('/incidents', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'An incident type is required', 400);
    }
    const user = req.user;
    const gateId = parsed.data.gateId || parsed.data.gate_id || user.gate_id || null;

    const incident = await queryOne(
      `INSERT INTO incidents (community_id, gate_id, reported_by, reported_by_name, type, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.community_id, gateId, user.sub, user.name || null, parsed.data.type, parsed.data.description || null]
    );

    // Surface to admin dashboards / other guards in real time.
    broadcast(user.community_id, 'incident:reported', shape(incident));

    return success(res, shape(incident), 201);
  } catch (err) {
    console.error('POST /incidents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /incidents (admin) — recent incidents for the community -------------

router.get('/incidents', authenticateJWT(['admin']), async (req, res) => {
  try {
    const status = req.query.status; // optional 'open' | 'reviewed'
    const params = [req.user.community_id];
    let sql = 'SELECT * FROM incidents WHERE community_id = $1';
    if (status === 'open' || status === 'reviewed') {
      sql += ' AND status = $2';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const rows = await queryRows(sql, params);
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /incidents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /incidents/:id/review (admin) --------------------------------------

router.post('/incidents/:id/review', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const existing = await queryOne(
      "SELECT id FROM incidents WHERE id = $1 AND community_id = $2 AND status = 'open'",
      [req.params.id, user.community_id]
    );
    if (!existing) {
      return error(res, 'Open incident not found', 404);
    }
    await query(
      "UPDATE incidents SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2",
      [user.sub, existing.id]
    );
    return success(res, { id: existing.id, status: 'reviewed' });
  } catch (err) {
    console.error('POST /incidents/:id/review error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
