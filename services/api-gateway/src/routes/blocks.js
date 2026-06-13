import { Router } from 'express';
import { queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// ── GET /blocks ───────────────────────────────────────────────────────────────
// List blocks in the caller's community.

router.get('/blocks', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;

    const rows = await queryRows(
      `SELECT id, name FROM blocks WHERE community_id = $1 ORDER BY name`,
      [community_id]
    );

    return success(res, rows.map((b) => ({ id: b.id, name: b.name })));
  } catch (err) {
    console.error('GET /blocks error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
