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
  // Optional, and absence is not the empty list. A client that predates
  // modules sends only the four flags, and must leave whatever this property
  // was sold exactly as it is -- silently widening a valet-only hotel back to
  // the full suite would undo the sale on the next unrelated toggle.
  //
  // An explicit empty list is refused rather than honoured: it would leave a
  // property logged in and looking at nothing at all.
  modules: z.array(z.enum(['gate', 'community', 'valet'])).nonempty().optional(),
});

// Starter (FASTag only) is the default for a community that has no row yet —
// never silently grant layers a society hasn't been sold (BRD §5.6).
/** gate = Nazar, community = Basera, valet = DwaarAI Valet. */
export const ALL_MODULES = ['gate', 'community', 'valet'];

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
  return {
    ...flags,
    tier: tierFor(flags),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    // Which products this property bought, and so which nav the portal shows.
    //
    // Absence means everything, never nothing. Every property predating this
    // column has no row or a null here, and reading that as "no modules"
    // would blank the nav of every existing customer at once.
    modules: row?.modules?.length ? row.modules : ALL_MODULES,
  };
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

// -- GET /entitlements/:communityId (super_admin only) -- admin-portal UI ----

router.get('/entitlements/:communityId', authenticateJWT(['super_admin']), async (req, res) => {
  try {
    const row = await queryOne('SELECT * FROM community_entitlements WHERE community_id = $1', [req.params.communityId]);
    return success(res, shape(row));
  } catch (err) {
    console.error('GET /entitlements/:communityId error:', err);
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
    const { fastag, anpr, face, aiAnomaly, modules } = parsed.data;
    const communityId = req.params.communityId;

    // Only read the stored list when the caller stayed silent about it, so the
    // common path is still a single write.
    let effectiveModules = modules;
    if (!effectiveModules) {
      const current = await queryOne(
        'SELECT modules FROM community_entitlements WHERE community_id = $1',
        [communityId]
      );
      effectiveModules = current?.modules?.length ? current.modules : ALL_MODULES;
    }

    await query(
      `INSERT INTO community_entitlements (community_id, fastag_enabled, anpr_enabled, face_enabled, ai_anomaly_enabled, modules, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (community_id) DO UPDATE SET
         fastag_enabled = $2, anpr_enabled = $3, face_enabled = $4, ai_anomaly_enabled = $5,
         modules = $6, updated_at = NOW(), updated_by = $7`,
      [communityId, fastag, anpr, face, aiAnomaly, effectiveModules, req.user.sub]
    );

    const data = shape({
      fastag_enabled: fastag, anpr_enabled: anpr, face_enabled: face, ai_anomaly_enabled: aiAnomaly,
      modules: effectiveModules,
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
