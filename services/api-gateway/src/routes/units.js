import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { authenticateJWT } from '../middleware/auth.js';
import { success, error } from '../middleware/response.js';

/**
 * Unit CRUD for the admin portal.
 *
 * The portal's Units page has always called GET/POST/PUT /units, but no such
 * route existed anywhere in the API — the page 404'd and rendered an empty
 * table, which read as "this community has no units" rather than as a missing
 * endpoint.
 *
 * The portal models `block` as the block's NAME, not its id, so this maps
 * between the two: reads join the name in, writes resolve it (creating the
 * block if the community does not have one by that name yet).
 */
const router = Router();

const unitSchema = z.object({
  unit_number: z.string().min(1).max(30),
  block: z.string().max(100).optional().nullable(),
  floor: z.union([z.string(), z.number()]).optional().nullable(),
  owner_name: z.string().max(200).optional().nullable(),
  status: z.string().max(20).optional(),
});

/** Resolve a block name to an id within this community, creating it if needed. */
async function resolveBlockId(communityId, blockName) {
  const name = String(blockName || '').trim();
  if (!name) return null;
  const existing = await queryOne(
    'SELECT id FROM blocks WHERE community_id = $1 AND lower(name) = lower($2)',
    [communityId, name]
  );
  if (existing) return existing.id;
  const created = await queryOne(
    'INSERT INTO blocks (community_id, name) VALUES ($1, $2) RETURNING id',
    [communityId, name]
  );
  return created.id;
}

/** Floor arrives as a string from the form; the column is an int. */
function parseFloor(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

// -- GET /units --------------------------------------------------------------
router.get('/units', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    if (!communityId) return error(res, 'No community selected', 400);

    const search = req.query.search || null;
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

    const params = [communityId];
    let sql = `SELECT u.id, u.unit_number, u.floor, u.owner_name, u.status,
                      COALESCE(b.name, '') AS block
                 FROM units u
                 LEFT JOIN blocks b ON b.id = u.block_id
                WHERE u.community_id = $1`;
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (u.unit_number ILIKE $${params.length} OR u.owner_name ILIKE $${params.length})`;
    }
    params.push(limit);
    sql += ` ORDER BY b.name NULLS LAST, u.unit_number LIMIT $${params.length}`;

    const rows = await queryRows(sql, params);
    return success(res, rows);
  } catch (err) {
    console.error('GET /units error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /units -------------------------------------------------------------
router.post('/units', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    if (!communityId) return error(res, 'No community selected', 400);

    const parsed = unitSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);
    const { unit_number, block, floor, owner_name, status } = parsed.data;

    const duplicate = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND lower(unit_number) = lower($2)',
      [communityId, unit_number]
    );
    if (duplicate) return error(res, 'A unit with that number already exists', 409);

    const blockId = await resolveBlockId(communityId, block);
    const row = await queryOne(
      `INSERT INTO units (community_id, block_id, unit_number, floor, owner_name, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, unit_number, floor, owner_name, status`,
      [communityId, blockId, unit_number, parseFloor(floor), owner_name || null, status || 'occupied']
    );
    return success(res, { ...row, block: block || '' }, 201);
  } catch (err) {
    console.error('POST /units error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /units/:id ----------------------------------------------------------
router.put('/units/:id', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    if (!communityId) return error(res, 'No community selected', 400);

    const parsed = unitSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);
    const { unit_number, block, floor, owner_name, status } = parsed.data;

    // Scoped to the caller's community, so an id from another tenant is a 404.
    const existing = await queryOne(
      'SELECT id FROM units WHERE id = $1 AND community_id = $2',
      [req.params.id, communityId]
    );
    if (!existing) return error(res, 'Unit not found', 404);

    const blockId = await resolveBlockId(communityId, block);
    const row = await queryOne(
      `UPDATE units
          SET unit_number = $1, block_id = $2, floor = $3, owner_name = $4, status = $5
        WHERE id = $6 AND community_id = $7
        RETURNING id, unit_number, floor, owner_name, status`,
      [unit_number, blockId, parseFloor(floor), owner_name || null,
       status || 'occupied', req.params.id, communityId]
    );
    return success(res, { ...row, block: block || '' });
  } catch (err) {
    console.error('PUT /units/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
