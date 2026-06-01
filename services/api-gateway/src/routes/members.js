import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'];

const createSchema = z.object({
  name: z.string().min(1).max(200),
  mobile: z.string().min(8).max(15),
  relationship: z.enum(RELATIONSHIPS).optional(),
  notify_on_approval: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  relationship: z.enum(RELATIONSHIPS).optional(),
  notify_on_approval: z.boolean().optional(),
});

// Normalize an Indian mobile to its 10-digit core (strips +91 / 91 / leading 0).
function normalizeMobile(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function isValidMobile(mobile) {
  return /^[6-9]\d{9}$/.test(mobile);
}

function shape(row, selfId) {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    relationship: row.relationship || null,
    type: row.type,
    is_primary: row.is_primary,
    notify_on_approval: row.notify_on_approval,
    is_self: row.id === selfId,
    created_at: row.created_at,
  };
}

// -- GET /members (resident JWT) ---------------------------------------------
// Roster of all active residents in the caller's unit.

router.get('/members', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const rows = await queryRows(
      `SELECT id, name, mobile, relationship, type, is_primary, notify_on_approval, created_at
         FROM residents
        WHERE unit_id = $1 AND is_active = true
        ORDER BY is_primary DESC, created_at ASC`,
      [user.unit_id]
    );
    return success(res, rows.map((r) => shape(r, user.sub)));
  } catch (err) {
    console.error('GET /members error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /members (resident JWT) --------------------------------------------
// Add a family member to the caller's household.

router.post('/members', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const user = req.user;
    const { name, relationship, notify_on_approval } = parsed.data;
    const mobile = normalizeMobile(parsed.data.mobile);

    if (!isValidMobile(mobile)) {
      return error(res, 'Enter a valid 10-digit Indian mobile number', 400);
    }

    // Edge case: this number is already registered in the community.
    // Never silently dual-register — tell the caller which case it is.
    const existing = await queryOne(
      'SELECT id, unit_id FROM residents WHERE community_id = $1 AND mobile = $2 AND is_active = true',
      [user.community_id, mobile]
    );
    if (existing) {
      if (existing.unit_id === user.unit_id) {
        return error(res, 'This number is already a member of your household', 409);
      }
      return error(res, 'This number is already registered to another unit', 409);
    }

    // Family members inherit the household type (owner / tenant) of the inviter.
    const inviter = await queryOne('SELECT type FROM residents WHERE id = $1', [user.sub]);
    const memberType = inviter?.type || 'owner';

    const member = await queryOne(
      `INSERT INTO residents
         (community_id, unit_id, name, mobile, type, relationship, is_primary, created_by, notify_on_approval)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8)
       RETURNING id, name, mobile, relationship, type, is_primary, notify_on_approval, created_at`,
      [
        user.community_id,
        user.unit_id,
        name,
        mobile,
        memberType,
        relationship || null,
        user.sub,
        notify_on_approval ?? true,
      ]
    );

    return success(res, shape(member, user.sub), 201);
  } catch (err) {
    console.error('POST /members error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /members/:id (resident JWT) -----------------------------------------

router.put('/members/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const user = req.user;
    const memberId = req.params.id;

    // Must be an active member of the caller's own unit.
    const existing = await queryOne(
      'SELECT id FROM residents WHERE id = $1 AND unit_id = $2 AND is_active = true',
      [memberId, user.unit_id]
    );
    if (!existing) {
      return error(res, 'Member not found', 404);
    }

    const data = parsed.data;
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.name !== undefined) { fields.push(`name = $${idx}`); values.push(data.name); idx++; }
    if (data.relationship !== undefined) { fields.push(`relationship = $${idx}`); values.push(data.relationship); idx++; }
    if (data.notify_on_approval !== undefined) { fields.push(`notify_on_approval = $${idx}`); values.push(data.notify_on_approval); idx++; }

    if (fields.length === 0) {
      return error(res, 'No fields to update', 400);
    }

    values.push(memberId);
    const updated = await queryOne(
      `UPDATE residents SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, mobile, relationship, type, is_primary, notify_on_approval, created_at`,
      values
    );

    return success(res, shape(updated, user.sub));
  } catch (err) {
    console.error('PUT /members/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /members/:id (resident JWT) --------------------------------------
// Soft-remove a household member. The primary resident cannot be removed here.

router.delete('/members/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const memberId = req.params.id;

    const existing = await queryOne(
      'SELECT id, is_primary FROM residents WHERE id = $1 AND unit_id = $2 AND is_active = true',
      [memberId, user.unit_id]
    );
    if (!existing) {
      return error(res, 'Member not found', 404);
    }
    if (existing.is_primary) {
      return error(res, 'The primary resident cannot be removed', 403);
    }

    await query(
      'UPDATE residents SET is_active = false WHERE id = $1',
      [memberId]
    );

    return success(res, { id: memberId, removed: true });
  } catch (err) {
    console.error('DELETE /members/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
