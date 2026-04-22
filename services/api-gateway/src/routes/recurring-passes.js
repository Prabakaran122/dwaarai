import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { generateExpectedVisits } from '../cron/generate-visits.js';

const router = Router();

const VALID_ROLES = ['maid', 'cook', 'driver', 'tutor', 'newspaper', 'other'];

const createSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  visitor_role: z.enum(VALID_ROLES).optional(),
  schedule_type: z.enum(['daily', 'weekday', 'weekly', 'custom']),
  schedule_days: z.array(z.number().min(0).max(6)).optional(),
  time_from: z.string().regex(/^\d{2}:\d{2}$/),
  time_until: z.string().regex(/^\d{2}:\d{2}$/),
});

const updateSchema = z.object({
  visitor_name: z.string().min(1).max(200).optional(),
  visitor_role: z.enum(VALID_ROLES).optional(),
  schedule_type: z.enum(['daily', 'weekday', 'weekly', 'custom']).optional(),
  schedule_days: z.array(z.number().min(0).max(6)).optional(),
  time_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  time_until: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// -- POST /recurring-passes (resident JWT) -----------------------------------

router.post('/recurring-passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, visitor_role, schedule_type, schedule_days, time_from, time_until } = parsed.data;
    const user = req.user;

    // Validate schedule_days for weekly/custom
    if ((schedule_type === 'weekly' || schedule_type === 'custom') && (!schedule_days || schedule_days.length === 0)) {
      return error(res, 'schedule_days required for weekly/custom schedule', 400);
    }

    const pass = await queryOne(
      `INSERT INTO recurring_passes
         (community_id, unit_id, created_by, visitor_name, visitor_name_normalized,
          visitor_role, schedule_type, schedule_days, time_from, time_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user.community_id, user.unit_id, user.sub, visitor_name, normalize(visitor_name),
       visitor_role || null, schedule_type, schedule_days || null, time_from, time_until]
    );

    // Generate today's expected visit if schedule matches
    await generateExpectedVisits();

    return success(res, pass, 201);
  } catch (err) {
    console.error('POST /recurring-passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /recurring-passes (resident JWT) ------------------------------------

router.get('/recurring-passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const today = new Date().toISOString().slice(0, 10);

    const passes = await queryRows(
      `SELECT rp.*,
              ev.status AS today_status,
              ev.arrived_at AS today_arrived_at,
              ev.photo_url AS today_photo_url
       FROM recurring_passes rp
       LEFT JOIN expected_visits ev
         ON ev.recurring_pass_id = rp.id AND ev.visit_date = $3
       WHERE rp.unit_id = $1 AND rp.status != 'cancelled'
       ORDER BY rp.created_at DESC`,
      [user.unit_id, user.community_id, today]
    );

    return success(res, passes);
  } catch (err) {
    console.error('GET /recurring-passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /recurring-passes/:id (resident JWT) --------------------------------

router.put('/recurring-passes/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const passId = req.params.id;
    const user = req.user;

    // Verify ownership
    const existing = await queryOne(
      'SELECT id FROM recurring_passes WHERE id = $1 AND created_by = $2',
      [passId, user.sub]
    );
    if (!existing) {
      return error(res, 'Pass not found', 404);
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    const data = parsed.data;
    if (data.visitor_name) {
      fields.push(`visitor_name = $${idx}`, `visitor_name_normalized = $${idx + 1}`);
      values.push(data.visitor_name, normalize(data.visitor_name));
      idx += 2;
    }
    if (data.visitor_role) { fields.push(`visitor_role = $${idx}`); values.push(data.visitor_role); idx++; }
    if (data.schedule_type) { fields.push(`schedule_type = $${idx}`); values.push(data.schedule_type); idx++; }
    if (data.schedule_days) { fields.push(`schedule_days = $${idx}`); values.push(data.schedule_days); idx++; }
    if (data.time_from) { fields.push(`time_from = $${idx}`); values.push(data.time_from); idx++; }
    if (data.time_until) { fields.push(`time_until = $${idx}`); values.push(data.time_until); idx++; }
    if (data.status) { fields.push(`status = $${idx}`); values.push(data.status); idx++; }

    if (fields.length === 0) {
      return error(res, 'No fields to update', 400);
    }

    values.push(passId);
    const updated = await queryOne(
      `UPDATE recurring_passes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return success(res, updated);
  } catch (err) {
    console.error('PUT /recurring-passes/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /recurring-passes/:id (resident JWT) -----------------------------

router.delete('/recurring-passes/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const passId = req.params.id;
    const user = req.user;

    const existing = await queryOne(
      'SELECT id FROM recurring_passes WHERE id = $1 AND created_by = $2',
      [passId, user.sub]
    );
    if (!existing) {
      return error(res, 'Pass not found', 404);
    }

    // Cancel the pass
    await query(
      "UPDATE recurring_passes SET status = 'cancelled' WHERE id = $1",
      [passId]
    );

    // Delete future expected visits (keep historical arrived records)
    await query(
      `DELETE FROM expected_visits
       WHERE recurring_pass_id = $1 AND visit_date >= CURRENT_DATE AND status = 'expected'`,
      [passId]
    );

    return success(res, { cancelled: true });
  } catch (err) {
    console.error('DELETE /recurring-passes/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
