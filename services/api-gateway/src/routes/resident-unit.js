import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// -- GET /resident/unit — unit identity aggregate ----------------------------
router.get('/resident/unit', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const unit = await queryOne(
      `SELECT u.unit_number, u.floor, u.wing, u.ownership_type, c.name AS community_name
         FROM units u JOIN communities c ON c.id = u.community_id
        WHERE u.id = $1 AND u.community_id = $2`,
      [unit_id, community_id]
    );
    const members = await queryRows(
      `SELECT r.id, r.name, r.relationship, r.is_primary,
              (fe.status = 'active') AS face_enrolled, r.is_active AS app_access
         FROM residents r
         LEFT JOIN face_enrollments fe ON fe.resident_id = r.id
        WHERE r.unit_id = $1 AND r.community_id = $2 AND r.is_active = true
        ORDER BY r.is_primary DESC, r.created_at ASC`,
      [unit_id, community_id]
    );
    const vehicles = await queryRows(
      `SELECT id, plate_display, plate, make, model, type, (fastag_tid_hash IS NOT NULL) AS fastag_linked
         FROM vehicles WHERE unit_id = $1 AND community_id = $2 AND is_active = true ORDER BY created_at ASC`,
      [unit_id, community_id]
    );
    const pets = await queryRows(
      `SELECT id, name, species, breed FROM pets
        WHERE unit_id = $1 AND community_id = $2 AND is_active = true ORDER BY created_at ASC`,
      [unit_id, community_id]
    );
    const duesRows = await queryRows(
      `SELECT base_amount, penalty_amount FROM dues
        WHERE community_id = $1 AND unit_id = $2 AND status = 'pending'`,
      [community_id, unit_id]
    );
    const outstanding = Number(
      duesRows.reduce((s, d) => s + Number(d.base_amount || 0) + Number(d.penalty_amount || 0), 0).toFixed(2)
    );
    return success(res, {
      unit: unit ? {
        unitNumber: unit.unit_number, floor: unit.floor, wing: unit.wing || null,
        ownershipType: unit.ownership_type || null, communityName: unit.community_name, verified: true,
      } : null,
      members: members.map((m) => ({
        id: m.id, name: m.name, relationship: m.relationship || null,
        isPrimary: m.is_primary, faceEnrolled: !!m.face_enrolled, appAccess: !!m.app_access,
      })),
      vehicles: vehicles.map((v) => ({
        id: v.id, plate: v.plate_display || v.plate,
        makeModel: [v.make, v.model].filter(Boolean).join(' ') || null,
        type: v.type, fastagLinked: !!v.fastag_linked,
      })),
      pets: pets.map((p) => ({ id: p.id, name: p.name, species: p.species, breed: p.breed || null })),
      dues: { outstanding, pendingCount: duesRows.length },
    });
  } catch (err) {
    console.error('GET /resident/unit error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
