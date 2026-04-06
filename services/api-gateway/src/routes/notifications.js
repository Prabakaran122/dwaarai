import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { sendVisitorAlert } from '../lib/fcm.js';

const router = Router();

const registerSchema = z.object({
  fcm_token: z.string().min(1).max(500),
});

const visitorAlertSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  unit_number: z.string().min(1).max(30),
  gate_id: z.string().uuid(),
});

// -- POST /notifications/register (JWT resident) ----------------------------

router.post('/notifications/register', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { fcm_token } = parsed.data;
    const userId = req.user.sub;

    await queryOne(
      'UPDATE residents SET fcm_token = $1 WHERE id = $2 RETURNING id',
      [fcm_token, userId]
    );

    return success(res, { registered: true });
  } catch (err) {
    console.error('POST /notifications/register error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notifications/unregister (JWT resident) --------------------------

router.post('/notifications/unregister', authenticateJWT(['resident']), async (req, res) => {
  try {
    const userId = req.user.sub;
    await queryOne(
      'UPDATE residents SET fcm_token = NULL WHERE id = $1 RETURNING id',
      [userId]
    );
    return success(res, { unregistered: true });
  } catch (err) {
    console.error('POST /notifications/unregister error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notifications/visitor-alert (JWT guard) --------------------------

router.post('/notifications/visitor-alert', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = visitorAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, unit_number, gate_id } = parsed.data;
    const community_id = req.user.community_id;

    // Find unit
    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community_id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found', 404);
    }

    // Get all residents in this unit with FCM tokens
    const residents = await queryRows(
      'SELECT fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
      [unit.id]
    );

    let notified = 0;
    for (const r of residents) {
      const result = await sendVisitorAlert(r.fcm_token, visitor_name, gate_id);
      if (result) notified++;
    }

    return success(res, { notified, total_residents: residents.length });
  } catch (err) {
    console.error('POST /notifications/visitor-alert error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
