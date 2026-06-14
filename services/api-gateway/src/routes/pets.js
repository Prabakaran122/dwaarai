import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'other'];

const createSchema = z.object({
  name: z.string().min(1).max(60),
  species: z.enum(SPECIES),
  breed: z.string().max(60).optional(),
  notes: z.string().max(280).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  species: z.enum(SPECIES).optional(),
  breed: z.string().max(60).optional(),
  notes: z.string().max(280).optional(),
});

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    breed: row.breed || null,
    notes: row.notes || null,
    created_at: row.created_at,
  };
}

// -- GET /pets (resident JWT) -------------------------------------------------
// List this unit's active pets, newest first.

router.get('/pets', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const rows = await queryRows(
      `SELECT id, name, species, breed, notes, created_at
         FROM pets
        WHERE unit_id = $1 AND community_id = $2 AND is_active = true
        ORDER BY created_at DESC`,
      [unit_id, community_id]
    );
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /pets error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /pets (resident JWT) ------------------------------------------------
// Add a pet to the caller's household.

router.post('/pets', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { community_id, unit_id, sub } = req.user;
    const { name, species, breed, notes } = parsed.data;

    const pet = await queryOne(
      `INSERT INTO pets (community_id, unit_id, created_by, name, species, breed, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, species, breed, notes, created_at`,
      [community_id, unit_id, sub, name, species, breed || null, notes || null]
    );

    return success(res, shape(pet), 201);
  } catch (err) {
    console.error('POST /pets error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /pets/:id (resident JWT) ---------------------------------------------
// Partial update of name/species/breed/notes for a pet owned by this unit.

router.put('/pets/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { unit_id } = req.user;
    const petId = req.params.id;

    const existing = await queryOne(
      'SELECT id FROM pets WHERE id = $1 AND unit_id = $2 AND is_active = true',
      [petId, unit_id]
    );
    if (!existing) {
      return error(res, 'Pet not found', 404);
    }

    const data = parsed.data;
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.name !== undefined) { fields.push(`name = $${idx}`); values.push(data.name); idx++; }
    if (data.species !== undefined) { fields.push(`species = $${idx}`); values.push(data.species); idx++; }
    if (data.breed !== undefined) { fields.push(`breed = $${idx}`); values.push(data.breed); idx++; }
    if (data.notes !== undefined) { fields.push(`notes = $${idx}`); values.push(data.notes); idx++; }

    if (fields.length === 0) {
      return error(res, 'No fields to update', 400);
    }

    values.push(petId);
    const updated = await queryOne(
      `UPDATE pets SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, species, breed, notes, created_at`,
      values
    );

    return success(res, shape(updated));
  } catch (err) {
    console.error('PUT /pets/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /pets/:id (resident JWT) ------------------------------------------
// Soft-delete a pet after verifying it belongs to the caller's unit.

router.delete('/pets/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { unit_id } = req.user;
    const petId = req.params.id;

    const existing = await queryOne(
      'SELECT id FROM pets WHERE id = $1 AND unit_id = $2 AND is_active = true',
      [petId, unit_id]
    );
    if (!existing) {
      return error(res, 'Pet not found', 404);
    }

    await queryOne(
      'UPDATE pets SET is_active = false WHERE id = $1 RETURNING id',
      [petId]
    );

    return success(res, { deleted: true });
  } catch (err) {
    console.error('DELETE /pets/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
