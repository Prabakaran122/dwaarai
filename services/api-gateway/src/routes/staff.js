import { Router } from 'express';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// -- GET /staff (guard) — full active daily-staff roster for the community ---
// Active recurring passes (maids/cooks/drivers/etc.) with today's arrival status,
// so a guard can fast-check-in anyone — even if today's expected visit wasn't generated.

router.get('/staff', authenticateJWT(['guard']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT rp.id, rp.visitor_name, rp.visitor_role, rp.time_from, rp.time_until,
              u.unit_number,
              ev.status AS today_status, ev.arrived_at AS today_arrived_at
         FROM recurring_passes rp
         JOIN units u ON rp.unit_id = u.id
         LEFT JOIN expected_visits ev
           ON ev.recurring_pass_id = rp.id AND ev.visit_date = CURRENT_DATE
        WHERE rp.community_id = $1 AND rp.status = 'active'
        ORDER BY u.unit_number, rp.visitor_name`,
      [req.user.community_id]
    );
    return success(res, rows.map((r) => ({
      pass_id: r.id,
      name: r.visitor_name,
      role: r.visitor_role || null,
      unit_number: r.unit_number,
      time_from: r.time_from,
      time_until: r.time_until,
      arrived: r.today_status === 'arrived',
      arrived_at: r.today_arrived_at || null,
    })));
  } catch (err) {
    console.error('GET /staff error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /staff/:passId/checkin (guard) — fast, photo-less arrival ----------
// Marks the staffer arrived today; works even off-schedule (creates the visit).

router.post('/staff/:passId/checkin', authenticateJWT(['guard']), async (req, res) => {
  try {
    const user = req.user;
    const pass = await queryOne(
      `SELECT id, unit_id, visitor_name_normalized, visitor_role, time_from, time_until
         FROM recurring_passes
        WHERE id = $1 AND community_id = $2 AND status = 'active'`,
      [req.params.passId, user.community_id]
    );
    if (!pass) {
      return error(res, 'Staff pass not found', 404);
    }

    const existing = await queryOne(
      'SELECT id, status FROM expected_visits WHERE recurring_pass_id = $1 AND visit_date = CURRENT_DATE',
      [pass.id]
    );

    let offSchedule = false;
    if (existing) {
      if (existing.status === 'arrived') {
        return success(res, { checked_in: true, already: true });
      }
      await query(
        "UPDATE expected_visits SET status = 'arrived', arrived_at = NOW(), marked_by = $1 WHERE id = $2",
        [user.sub, existing.id]
      );
    } else {
      // No scheduled visit today — check them in anyway (off-schedule arrival).
      offSchedule = true;
      await query(
        `INSERT INTO expected_visits
           (recurring_pass_id, community_id, unit_id, visit_date, time_from, time_until,
            visitor_name_normalized, visitor_role, status, arrived_at, marked_by)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, 'arrived', NOW(), $8)`,
        [pass.id, user.community_id, pass.unit_id, pass.time_from, pass.time_until,
         pass.visitor_name_normalized, pass.visitor_role, user.sub]
      );
    }

    return success(res, { checked_in: true, off_schedule: offSchedule });
  } catch (err) {
    console.error('POST /staff/:passId/checkin error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
