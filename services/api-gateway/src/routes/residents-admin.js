import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { authenticateJWT } from '../middleware/auth.js';
import { success, error } from '../middleware/response.js';
import { COMMITTEE_ROLES } from '../lib/committee.js';

const router = Router();

export function validCommitteeRole(role) {
  return role === null || COMMITTEE_ROLES.includes(role);
}

// residents.type also holds 'guard' (see 017_guard_language.sql) — guards are
// never eligible for a committee role, so they must not show up in a screen
// whose only action is assigning one.
const NON_COMMITTEE_ELIGIBLE_TYPES = ['guard'];

// `search` lands straight in a LIKE pattern; a resident's own name/unit number
// could contain '%' or '_' and act as an unintended wildcard. Low severity on
// an admin-only screen, but cheap to close, so we escape both plus the escape
// character itself before building the pattern.
function escapeLikeWildcards(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

router.get('/admin/residents', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    if (!communityId) return error(res, 'No community selected', 400);
    const params = [communityId];
    let sql = `SELECT r.id, r.name, r.type, r.committee_role,
                      COALESCE(u.unit_number, '') AS unit
                 FROM residents r
                 LEFT JOIN units u ON u.id = r.unit_id
                WHERE r.community_id = $1 AND r.is_active = true
                  AND r.type NOT IN (${NON_COMMITTEE_ELIGIBLE_TYPES.map((_, i) => `$${i + 2}`).join(', ')})`;
    params.push(...NON_COMMITTEE_ELIGIBLE_TYPES);
    if (req.query.search) {
      params.push(`%${escapeLikeWildcards(String(req.query.search))}%`);
      sql += ` AND (r.name ILIKE $${params.length} ESCAPE '\\' OR u.unit_number ILIKE $${params.length} ESCAPE '\\')`;
    }
    sql += ' ORDER BY r.committee_role NULLS LAST, u.unit_number, r.name LIMIT 500';
    return success(res, await queryRows(sql, params));
  } catch (err) {
    console.error('GET /admin/residents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

router.put('/admin/residents/:id/committee-role', authenticateJWT(['admin']), async (req, res) => {
  try {
    const parsed = z.object({
      committee_role: z.enum(COMMITTEE_ROLES).nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);

    const communityId = req.user.community_id;
    const row = await queryOne(
      `UPDATE residents SET committee_role = $1, is_committee = ($1 IS NOT NULL)
        WHERE id = $2 AND community_id = $3
        RETURNING id, name, committee_role`,
      [parsed.data.committee_role, req.params.id, communityId]
    );
    if (!row) return error(res, 'Resident not found', 404);
    return success(res, row);
  } catch (err) {
    console.error('PUT /admin/residents/:id/committee-role error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
