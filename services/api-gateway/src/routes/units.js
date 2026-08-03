import { Router } from 'express';
import { z } from 'zod';
import { queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const lookupSchema = z.object({ q: z.string().min(2).max(50) });

function shape(row) {
  return {
    unitId: row.unit_id,
    unitNumber: row.unit_number,
    residentName: row.resident_name,
    relationship: row.relationship,
    mobile: row.mobile,
  };
}

// -- GET /units/lookup?q= (guard JWT) -----------------------------------------
// Unit/resident search for the new-vehicle-entry and walk-in-visitor intake
// flows (NAZ-024): "search by unit number or resident name; shows matched
// resident card with unit, name, owner/tenant status."

router.get('/units/lookup', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = lookupSchema.safeParse(req.query);
    if (!parsed.success) {
      return error(res, 'Query must be at least 2 characters', 400, parsed.error.issues);
    }
    const like = `%${parsed.data.q}%`;
    const rows = await queryRows(
      `SELECT u.id AS unit_id, u.unit_number, r.name AS resident_name, r.type AS relationship, r.mobile
         FROM units u
         LEFT JOIN residents r ON r.unit_id = u.id AND r.is_primary = true AND r.is_active = true
        WHERE u.community_id = $1 AND (u.unit_number ILIKE $2 OR r.name ILIKE $2)
        ORDER BY u.unit_number
        LIMIT 5`,
      [req.user.community_id, like]
    );
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /units/lookup error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
