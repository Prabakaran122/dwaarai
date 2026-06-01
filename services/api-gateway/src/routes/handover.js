import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const createSchema = z.object({
  note: z.string().min(1).max(2000),
});

// -- POST /handover (guard) — record an end-of-shift note --------------------

router.post('/handover', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'A handover note is required', 400);
    }
    const user = req.user;
    const row = await queryOne(
      `INSERT INTO shift_handovers (community_id, gate_id, guard_id, guard_name, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, note, guard_name, created_at`,
      [user.community_id, user.gate_id || null, user.sub, user.name || null, parsed.data.note]
    );
    return success(res, row, 201);
  } catch (err) {
    console.error('POST /handover error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /handover/latest (guard) — last note + live open items --------------

router.get('/handover/latest', authenticateJWT(['guard']), async (req, res) => {
  try {
    const user = req.user;

    const latest = await queryOne(
      `SELECT note, guard_name, created_at
         FROM shift_handovers
        WHERE community_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [user.community_id]
    );

    const sos = await queryOne(
      "SELECT COUNT(*)::int AS n FROM sos_alerts WHERE community_id = $1 AND status = 'active'",
      [user.community_id]
    );
    const deliveries = await queryOne(
      "SELECT COUNT(*)::int AS n FROM deliveries WHERE community_id = $1 AND status = 'waiting'",
      [user.community_id]
    );

    return success(res, {
      handover: latest || null,
      open_items: {
        sos_active: sos?.n || 0,
        deliveries_waiting: deliveries?.n || 0,
      },
    });
  } catch (err) {
    console.error('GET /handover/latest error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
