import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const superOnly = authenticateJWT(['super_admin']);

// -- Zod schemas --------------------------------------------------------------

const createCommunitySchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(15).optional(),
});

const updateCommunitySchema = createCommunitySchema.partial();

const createAdminSchema = z.object({
  name: z.string().min(1).max(200),
  username: z.string().min(3).max(100),
  password: z.string().min(6).max(200),
  role: z.enum(['community_admin']),
  community_id: z.string().uuid(),
});

// -- GET /admin/communities ---------------------------------------------------

router.get('/admin/communities', superOnly, async (req, res) => {
  try {
    const communities = await queryRows(`
      SELECT c.*,
        (SELECT count(*) FROM gates WHERE community_id = c.id AND is_active = true) as gate_count,
        (SELECT count(*) FROM units WHERE community_id = c.id) as unit_count,
        (SELECT count(*) FROM residents WHERE community_id = c.id AND is_active = true) as resident_count,
        (SELECT count(*) FROM vehicles WHERE community_id = c.id AND is_active = true) as vehicle_count
      FROM communities c
      WHERE c.is_active = true
      ORDER BY c.name
    `);
    return success(res, { communities });
  } catch (err) {
    console.error('GET /admin/communities error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/communities --------------------------------------------------

router.post('/admin/communities', superOnly, async (req, res) => {
  try {
    const parsed = createCommunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, address, contact_name, contact_phone } = parsed.data;
    const community = await queryOne(
      `INSERT INTO communities (name, address, contact_name, contact_phone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, address || null, contact_name || null, contact_phone || null]
    );
    return success(res, { community }, 201);
  } catch (err) {
    console.error('POST /admin/communities error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/communities/:id -----------------------------------------------

router.get('/admin/communities/:id', superOnly, async (req, res) => {
  try {
    const community = await queryOne(`
      SELECT c.*,
        (SELECT count(*) FROM gates WHERE community_id = c.id AND is_active = true) as gate_count,
        (SELECT count(*) FROM units WHERE community_id = c.id) as unit_count,
        (SELECT count(*) FROM residents WHERE community_id = c.id AND is_active = true) as resident_count,
        (SELECT count(*) FROM vehicles WHERE community_id = c.id AND is_active = true) as vehicle_count
      FROM communities c WHERE c.id = $1
    `, [req.params.id]);
    if (!community) return error(res, 'Community not found', 404);
    return success(res, { community });
  } catch (err) {
    console.error('GET /admin/communities/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /admin/communities/:id -----------------------------------------------

router.put('/admin/communities/:id', superOnly, async (req, res) => {
  try {
    const parsed = updateCommunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const fields = parsed.data;
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }
    if (sets.length === 0) return error(res, 'No fields to update', 400);
    values.push(req.params.id);
    const community = await queryOne(
      `UPDATE communities SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!community) return error(res, 'Community not found', 404);
    return success(res, { community });
  } catch (err) {
    console.error('PUT /admin/communities/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/community-admins ----------------------------------------------

router.get('/admin/community-admins', superOnly, async (req, res) => {
  try {
    const admins = await queryRows(`
      SELECT a.id, a.name, a.username, a.role, a.community_id, a.is_active, a.created_at,
             c.name as community_name
      FROM admins a
      LEFT JOIN communities c ON a.community_id = c.id
      WHERE a.role = 'community_admin'
      ORDER BY a.name
    `);
    return success(res, { admins });
  } catch (err) {
    console.error('GET /admin/community-admins error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/community-admins ---------------------------------------------

router.post('/admin/community-admins', superOnly, async (req, res) => {
  try {
    const parsed = createAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, username, password, role, community_id } = parsed.data;

    // Check username uniqueness
    const existing = await queryOne('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing) return error(res, 'Username already exists', 409);

    // Verify community exists
    const community = await queryOne('SELECT id FROM communities WHERE id = $1', [community_id]);
    if (!community) return error(res, 'Community not found', 404);

    const password_hash = await bcrypt.hash(password, 10);
    const admin = await queryOne(
      `INSERT INTO admins (name, username, password_hash, role, community_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, username, role, community_id, is_active, created_at`,
      [name, username, password_hash, role, community_id]
    );
    return success(res, { admin }, 201);
  } catch (err) {
    console.error('POST /admin/community-admins error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /admin/community-admins/:id (deactivate) --------------------------

router.delete('/admin/community-admins/:id', superOnly, async (req, res) => {
  try {
    const admin = await queryOne(
      'UPDATE admins SET is_active = false WHERE id = $1 AND role = $2 RETURNING id, name',
      [req.params.id, 'community_admin']
    );
    if (!admin) return error(res, 'Admin not found', 404);
    return success(res, { deactivated: admin.id });
  } catch (err) {
    console.error('DELETE /admin/community-admins/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
