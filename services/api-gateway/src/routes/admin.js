import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import pool from '../db/pool.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const superOnly = authenticateJWT(['super_admin']);
const adminOnly = authenticateJWT(['admin']);

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

const _time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'HH:MM');

const createCardSchema = z.object({
  community_id: z.string().uuid(),
  uid_hash: z.string().length(64),
  card_number: z.string().max(50).optional(),
  issued_to_unit: z.string().uuid().optional(),
  card_type: z.enum(['resident', 'visitor', 'staff', 'master']).default('resident'),
  expires_at: z.string().datetime().optional(),
  holder_name: z.string().max(200).optional(),
  access_start: _time.optional(),   // daily window (staff), e.g. "09:00"
  access_end: _time.optional(),
});

const updateCardSchema = z.object({
  card_number: z.string().max(50).optional(),
  issued_to_unit: z.string().uuid().nullable().optional(),
  card_type: z.enum(['resident', 'visitor', 'staff', 'master']).optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  holder_name: z.string().max(200).nullable().optional(),
  access_start: _time.nullable().optional(),
  access_end: _time.nullable().optional(),
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

// -- GET /admin/rfid-cards ---------------------------------------------------

router.get('/admin/rfid-cards', superOnly, async (req, res) => {
  try {
    const communityFilter = req.query.community_id;
    const activeOnly = req.query.active !== 'false';
    let sql = `
      SELECT rc.*, u.unit_number, c.name as community_name
      FROM rfid_cards rc
      LEFT JOIN units u ON rc.issued_to_unit = u.id
      LEFT JOIN communities c ON rc.community_id = c.id
    `;
    const conditions = [];
    const values = [];
    if (communityFilter) {
      values.push(communityFilter);
      conditions.push(`rc.community_id = $${values.length}`);
    }
    if (activeOnly) {
      conditions.push('rc.is_active = true');
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY rc.issued_at DESC';
    const cards = await queryRows(sql, values);
    return success(res, { cards });
  } catch (err) {
    console.error('GET /admin/rfid-cards error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/rfid-cards --------------------------------------------------

router.post('/admin/rfid-cards', superOnly, async (req, res) => {
  try {
    const parsed = createCardSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, uid_hash, card_number, issued_to_unit, card_type,
            expires_at, holder_name, access_start, access_end } = parsed.data;

    // Check uniqueness
    const existing = await queryOne('SELECT id FROM rfid_cards WHERE uid_hash = $1', [uid_hash]);
    if (existing) return error(res, 'Card UID already registered', 409);

    // Verify community
    const community = await queryOne('SELECT id FROM communities WHERE id = $1', [community_id]);
    if (!community) return error(res, 'Community not found', 404);

    const card = await queryOne(
      `INSERT INTO rfid_cards (community_id, uid_hash, card_number, issued_to_unit, card_type,
                               expires_at, holder_name, access_start, access_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [community_id, uid_hash, card_number || null, issued_to_unit || null, card_type,
       expires_at || null, holder_name || null, access_start || null, access_end || null]
    );
    return success(res, { card }, 201);
  } catch (err) {
    console.error('POST /admin/rfid-cards error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /admin/rfid-cards/:id -----------------------------------------------

router.put('/admin/rfid-cards/:id', superOnly, async (req, res) => {
  try {
    const parsed = updateCardSchema.safeParse(req.body);
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
    const card = await queryOne(
      `UPDATE rfid_cards SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!card) return error(res, 'Card not found', 404);
    return success(res, { card });
  } catch (err) {
    console.error('PUT /admin/rfid-cards/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /admin/rfid-cards/:id (deactivate) -------------------------------

router.delete('/admin/rfid-cards/:id', superOnly, async (req, res) => {
  try {
    const card = await queryOne(
      'UPDATE rfid_cards SET is_active = false WHERE id = $1 RETURNING id, uid_hash',
      [req.params.id]
    );
    if (!card) return error(res, 'Card not found', 404);
    return success(res, { deactivated: card.id });
  } catch (err) {
    console.error('DELETE /admin/rfid-cards/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/guards --------------------------------------------------------

router.get('/admin/guards', adminOnly, async (req, res) => {
  try {
    const communityId = req.user.community_id;
    let sql = `
      SELECT r.id, r.name, r.mobile, r.community_id, r.is_active, r.created_at,
             r.password_hash IS NOT NULL AS has_password,
             c.name AS community_name,
             g.name AS gate_name
      FROM residents r
      LEFT JOIN communities c ON r.community_id = c.id
      LEFT JOIN gates g ON g.community_id = r.community_id AND g.is_active = true
      WHERE r.type = 'guard'
    `;
    const values = [];
    if (communityId) {
      values.push(communityId);
      sql += ` AND r.community_id = $${values.length}`;
    }
    sql += ' ORDER BY r.name';
    const guards = await queryRows(sql, values);
    return success(res, { guards });
  } catch (err) {
    console.error('GET /admin/guards error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/guards -------------------------------------------------------

const createGuardSchema = z.object({
  name: z.string().min(1).max(200),
  mobile: z.string().min(10).max(15),
  password: z.string().min(6).max(200),
  community_id: z.string().uuid(),
});

router.post('/admin/guards', adminOnly, async (req, res) => {
  try {
    const parsed = createGuardSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, mobile, password, community_id } = parsed.data;

    // Verify admin has access to this community
    if (req.user.role !== 'super_admin' && req.user.community_id !== community_id) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Check mobile uniqueness within community
    const existing = await queryOne(
      "SELECT id FROM residents WHERE community_id = $1 AND mobile = $2 AND type = 'guard' AND is_active = true",
      [community_id, mobile]
    );
    if (existing) return error(res, 'A guard with this mobile number already exists', 409);

    // Need a unit for the guard — find or create a "Guards" unit
    let guardUnit = await queryOne(
      "SELECT id FROM units WHERE community_id = $1 AND unit_number = 'GUARD-POST'",
      [community_id]
    );
    if (!guardUnit) {
      guardUnit = await queryOne(
        "INSERT INTO units (community_id, unit_number, floor, status) VALUES ($1, 'GUARD-POST', 'G', 'occupied') RETURNING id",
        [community_id]
      );
    }

    const password_hash = await bcrypt.hash(password, 12);
    const guard = await queryOne(
      `INSERT INTO residents (community_id, unit_id, name, mobile, type, is_primary, password_hash)
       VALUES ($1, $2, $3, $4, 'guard', false, $5)
       RETURNING id, community_id, name, mobile, type, is_active, created_at`,
      [community_id, guardUnit.id, name, mobile, password_hash]
    );

    return success(res, { guard }, 201);
  } catch (err) {
    console.error('POST /admin/guards error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /admin/guards/:id (deactivate) ------------------------------------

router.delete('/admin/guards/:id', adminOnly, async (req, res) => {
  try {
    const guard = await queryOne(
      "SELECT id, community_id FROM residents WHERE id = $1 AND type = 'guard'",
      [req.params.id]
    );
    if (!guard) return error(res, 'Guard not found', 404);

    if (req.user.role !== 'super_admin' && req.user.community_id !== guard.community_id) {
      return error(res, 'Insufficient permissions', 403);
    }

    await query("UPDATE residents SET is_active = false WHERE id = $1", [req.params.id]);
    return success(res, { deactivated: req.params.id });
  } catch (err) {
    console.error('DELETE /admin/guards/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/change-password -----------------------------------------------

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(200),
});

router.post('/admin/change-password', adminOnly, async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { current_password, new_password } = parsed.data;

    const admin = await queryOne(
      'SELECT id, password_hash FROM admins WHERE id = $1 AND is_active = true',
      [req.user.sub]
    );
    if (!admin) return error(res, 'Admin not found', 404);

    const valid = await bcrypt.compare(current_password, admin.password_hash);
    if (!valid) return error(res, 'Current password is incorrect', 401);

    const newHash = await bcrypt.hash(new_password, 12);
    await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [newHash, admin.id]);

    return success(res, { message: 'Password changed successfully' });
  } catch (err) {
    console.error('POST /admin/change-password error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/set-guard-password --------------------------------------------

const setGuardPasswordSchema = z.object({
  guard_id: z.string().uuid(),
  password: z.string().min(6).max(200),
});

router.post('/admin/set-guard-password', adminOnly, async (req, res) => {
  try {
    const parsed = setGuardPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { guard_id, password } = parsed.data;

    const guard = await queryOne(
      "SELECT id, name, community_id FROM residents WHERE id = $1 AND type = 'guard' AND is_active = true",
      [guard_id]
    );
    if (!guard) return error(res, 'Guard not found', 404);

    // Verify admin has access to this community
    if (req.user.role !== 'super_admin' && req.user.community_id !== guard.community_id) {
      return error(res, 'Insufficient permissions', 403);
    }

    const hash = await bcrypt.hash(password, 12);
    await query('UPDATE residents SET password_hash = $1 WHERE id = $2', [hash, guard_id]);

    return success(res, { message: `Password set for guard: ${guard.name}` });
  } catch (err) {
    console.error('POST /admin/set-guard-password error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// NOTE: /admin/dashboard/stats used to be defined here as well as in events.js.
// events.js mounts first, so this copy was dead code — and the two disagreed:
// this one counted gates by `is_active` and labelled the result "gatesOnline".
// Removed rather than left as a trap. The live dashboard uses
// /admin/dashboard/summary (routes/dashboard.js).

export default router;

// -- POST /admin/onboarding/valet ---------------------------------------------

const onboardValetSchema = z.object({
  property: z.object({
    name: z.string().min(1).max(200),
    address: z.string().max(500).optional(),
    contactName: z.string().max(200).optional(),
    contactPhone: z.string().max(20).optional(),
  }),
  admin: z.object({
    name: z.string().min(1).max(200),
    username: z.string().min(3).max(100),
    // Long enough to be worth setting. The person typing it is handing it to
    // a customer, and "admin123" is how this product already has a live
    // account nobody has rotated.
    password: z.string().min(8).max(200),
  }),
  modules: z.array(z.enum(['gate', 'community', 'valet'])).nonempty().optional(),
});

/**
 * Stands up a new valet property in one act.
 *
 * Onboarding is three writes across three tables -- the property, what it was
 * sold, and the login that will administer it -- and until now it was three
 * screens with nothing tying them together. Half-finished was a real state:
 * a property on the list with no way to sign into it looks onboarded from
 * every angle and cannot be used, and nobody finds out until the customer
 * tries. So all three go in one transaction, or none of them do.
 *
 * Cards, slots and branding are deliberately not here. They belong to the
 * property once it exists, they are edited repeatedly afterwards, and a valet
 * stand can open without them.
 */
router.post('/admin/onboarding/valet', superOnly, async (req, res) => {
  const parsed = onboardValetSchema.safeParse(req.body);
  if (!parsed.success) {
    return error(res, 'Validation error', 400, parsed.error.issues);
  }
  const { property, admin, modules } = parsed.data;
  // This flow exists to sell valet; anything wider is an explicit choice.
  const sold = modules ?? ['valet'];

  // Everything from here is inside a try. Express 4 does not catch a rejected
  // promise from an async handler: it leaves the caller holding a socket that
  // never answers, which is worse than any error code. The username lookup,
  // the hash and pool.connect() can all fail, so none of them sit outside.
  let client;
  try {
    // Checked before opening a transaction: a taken username is the one
    // failure worth reporting as itself rather than as a rolled-back 500.
    const taken = await queryOne('SELECT id FROM admins WHERE username = $1', [admin.username]);
    if (taken) return error(res, 'Username already exists', 409);

    const password_hash = await bcrypt.hash(admin.password, 10);
    client = await pool.connect();
    await client.query('BEGIN');

      const created = await client.query(
        `INSERT INTO communities (name, address, contact_name, contact_phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [property.name, property.address || null, property.contactName || null, property.contactPhone || null]
      );
      const communityId = created.rows[0].id;

      await client.query(
        `INSERT INTO community_entitlements
           (community_id, fastag_enabled, anpr_enabled, face_enabled, ai_anomaly_enabled, modules, updated_at, updated_by)
         VALUES ($1, false, false, false, false, $2, NOW(), $3)`,
        [communityId, sold, req.user.sub]
      );

      await client.query(
        `INSERT INTO admins (name, username, password_hash, role, community_id)
         VALUES ($1, $2, $3, 'community_admin', $4)`,
        [admin.name, admin.username, password_hash, communityId]
      );

      await client.query('COMMIT');
      return success(res, {
        communityId,
        communityName: property.name,
        adminUsername: admin.username,
        modules: sold,
      }, 201);
  } catch (err) {
    // Only roll back a transaction that was actually opened -- a failure in
    // pool.connect() leaves nothing to roll back and no client to release.
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('POST /admin/onboarding/valet error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    if (client) client.release();
  }
});

// -- DELETE /admin/communities/:id --------------------------------------------

/** What a property has to be empty of before it can be removed. */
const BLOCKING_COUNTS = [
  ['residents', 'residents'],
  ['units', 'units'],
  ['gates', 'gates'],
  ['vehicles', 'vehicles'],
  ['tickets', 'valet tickets'],
];

/**
 * Removes a property that should not have existed.
 *
 * This exists for the onboarding mistake -- the duplicate, the typo, the smoke
 * test -- and deliberately not for retiring a live customer. Anything a
 * property has actually accumulated blocks the delete and is named in the
 * refusal, because "no" without the count sends somebody hunting through five
 * screens to find out why.
 *
 * Valet tickets are counted alongside residents and units for a reason: a
 * hotel has no residents or units at all, so counting only those would make
 * every valet property look empty and freely deletable.
 *
 * What goes with it is only what was made for it and means nothing without
 * it -- the entitlement row and the logins scoped to it. Everything else is
 * the operational data that blocked the delete in the first place.
 */
router.delete('/admin/communities/:id', superOnly, async (req, res) => {
  let client;
  try {
    const community = await queryOne('SELECT id, name FROM communities WHERE id = $1', [req.params.id]);
    if (!community) return error(res, 'Community not found', 404);

    const counts = await queryOne(
      `SELECT
         (SELECT count(*) FROM residents      WHERE community_id = $1) AS residents,
         (SELECT count(*) FROM units          WHERE community_id = $1) AS units,
         (SELECT count(*) FROM gates          WHERE community_id = $1) AS gates,
         (SELECT count(*) FROM vehicles       WHERE community_id = $1) AS vehicles,
         (SELECT count(*) FROM valet_tickets  WHERE community_id = $1) AS tickets`,
      [community.id]
    );

    const blocking = BLOCKING_COUNTS
      .map(([key, label]) => [Number(counts?.[key] ?? 0), label])
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${n} ${label}`);

    if (blocking.length) {
      return error(
        res,
        `${community.name} still has ${blocking.join(', ')}. Remove those first, or deactivate the property instead.`,
        409
      );
    }

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM admins WHERE community_id = $1', [community.id]);
    await client.query('DELETE FROM community_entitlements WHERE community_id = $1', [community.id]);
    await client.query('DELETE FROM communities WHERE id = $1', [community.id]);
    await client.query('COMMIT');

    return success(res, { deleted: community.name });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('DELETE /admin/communities/:id error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    if (client) client.release();
  }
});
