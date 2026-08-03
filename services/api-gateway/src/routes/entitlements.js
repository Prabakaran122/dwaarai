import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';

const router = Router();

const putSchema = z.object({
  fastag: z.boolean(),
  anpr: z.boolean(),
  face: z.boolean(),
  aiAnomaly: z.boolean(),
});

// Starter (FASTag only) is the default for a community that has no row yet —
// never silently grant layers a society hasn't been sold (BRD §5.6).
const DEFAULTS = { fastag: true, anpr: false, face: false, aiAnomaly: false };

function tierFor({ fastag, anpr, face, aiAnomaly }) {
  if (fastag && anpr && face && aiAnomaly) return 'Elite';
  if (anpr && face) return 'Pro';
  if (fastag && anpr) return 'Basic';
  return 'Starter';
}

function shape(row) {
  const flags = row
    ? { fastag: row.fastag_enabled, anpr: row.anpr_enabled, face: row.face_enabled, aiAnomaly: row.ai_anomaly_enabled }
    : DEFAULTS;
  return { ...flags, tier: tierFor(flags), updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null };
}

// -- GET /entitlements (any authenticated role) -- caller's own community ----

router.get('/entitlements', authenticateJWT(), async (req, res) => {
  try {
    const row = await queryOne('SELECT * FROM community_entitlements WHERE community_id = $1', [req.user.community_id]);
    return success(res, shape(row));
  } catch (err) {
    console.error('GET /entitlements error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /entitlements/:communityId (super_admin only, Dwaar AI ops) ---------

router.put('/entitlements/:communityId', authenticateJWT(['super_admin']), async (req, res) => {
  try {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { fastag, anpr, face, aiAnomaly } = parsed.data;
    const communityId = req.params.communityId;

    await query(
      `INSERT INTO community_entitlements (community_id, fastag_enabled, anpr_enabled, face_enabled, ai_anomaly_enabled, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (community_id) DO UPDATE SET
         fastag_enabled = $2, anpr_enabled = $3, face_enabled = $4, ai_anomaly_enabled = $5,
         updated_at = NOW(), updated_by = $6`,
      [communityId, fastag, anpr, face, aiAnomaly, req.user.sub]
    );

    const data = shape({
      fastag_enabled: fastag, anpr_enabled: anpr, face_enabled: face, ai_anomaly_enabled: aiAnomaly,
      updated_at: new Date(),
    });
    broadcast(communityId, 'entitlement:updated', data);
    return success(res, data);
  } catch (err) {
    console.error('PUT /entitlements/:communityId error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
