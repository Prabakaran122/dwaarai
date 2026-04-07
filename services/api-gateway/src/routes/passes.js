import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, authenticateDevice } from '../middleware/auth.js';

const router = Router();

// -- OTP generator -----------------------------------------------------------

function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

// -- Zod schemas -------------------------------------------------------------

const createPassSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  visitor_mobile: z.string().min(7).max(15).optional(),
  visitor_vehicle: z.string().max(20).optional(),
  valid_from: z.string().datetime(),
  valid_until: z.string().datetime(),
  max_uses: z.number().int().min(1).default(1),
});

const verifyOTPSchema = z.object({
  otp: z.string().min(4).max(8),
  gate_id: z.string().uuid(),
});

const assignRFIDSchema = z.object({
  pass_id: z.string().uuid(),
  rfid_uid_hash: z.string().length(64),
});

// -- POST /passes (JWT resident) ---------------------------------------------

router.post('/passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, visitor_mobile, visitor_vehicle, valid_from, valid_until, max_uses } = parsed.data;
    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const created_by = user.sub;

    const otp = generateOTP(6);

    const pass = await queryOne(
      `INSERT INTO visitor_passes
         (community_id, unit_id, created_by, visitor_name, visitor_mobile, visitor_vehicle, otp, valid_from, valid_until, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [community_id, unit_id, created_by, visitor_name, visitor_mobile || null, visitor_vehicle || null, otp, valid_from, valid_until, max_uses]
    );

    return success(res, pass, 201);
  } catch (err) {
    console.error('POST /passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /passes (JWT resident|admin) ----------------------------------------

router.get('/passes', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const user = req.user;
    const community_id = user.community_id;
    const cursor = req.query.cursor || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const statusFilter = req.query.status || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let sql, params;
    if (user.role === 'admin') {
      sql = 'SELECT * FROM visitor_passes WHERE community_id = $1';
      params = [community_id];
    } else {
      sql = 'SELECT * FROM visitor_passes WHERE community_id = $1 AND unit_id = $2';
      params = [community_id, user.unit_id];
    }

    if (statusFilter) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(statusFilter);
    }
    if (dateFrom) {
      sql += ` AND valid_from >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND valid_until <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (cursor) {
      sql += ` AND created_at < $${params.length + 1}`;
      params.push(cursor);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].created_at.toISOString() : null;

    return success(res, data);
  } catch (err) {
    console.error('GET /passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /passes/:id (JWT resident) ---------------------------------------

router.delete('/passes/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const passId = req.params.id;

    const revoked = await queryOne(
      `UPDATE visitor_passes
       SET status = 'revoked'
       WHERE id = $1 AND created_by = $2 AND status = 'active'
       RETURNING *`,
      [passId, user.sub]
    );

    if (!revoked) {
      return error(res, 'Pass not found or already revoked', 404);
    }

    return success(res, revoked);
  } catch (err) {
    console.error('DELETE /passes/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /passes/verify (device token) --------------------------------------

router.post('/passes/verify', authenticateDevice, async (req, res) => {
  try {
    const parsed = verifyOTPSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { otp, gate_id } = parsed.data;
    const device = req.device;
    const community_id = device.community_id;

    const pass = await queryOne(
      `SELECT * FROM visitor_passes
       WHERE community_id = $1
         AND otp = $2
         AND status = 'active'
         AND valid_until > NOW()
         AND valid_from <= NOW()
         AND uses_count < max_uses`,
      [community_id, otp]
    );

    if (!pass) {
      return success(res, { decision: 'deny', reason: 'invalid_or_expired', message: 'OTP not valid or pass expired' });
    }

    const newUsesCount = pass.uses_count + 1;
    const newStatus = newUsesCount >= pass.max_uses ? 'used' : 'active';

    await query(
      'UPDATE visitor_passes SET uses_count = $1, status = $2 WHERE id = $3',
      [newUsesCount, newStatus, pass.id]
    );

    return success(res, {
      decision: 'allow',
      pass_id: pass.id,
      visitor_name: pass.visitor_name,
      unit_id: pass.unit_id,
      gate_id,
      uses_count: newUsesCount,
      max_uses: pass.max_uses,
      message: 'Visitor pass verified',
    });
  } catch (err) {
    console.error('POST /passes/verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /passes/assign-rfid (JWT admin) ------------------------------------

router.post('/passes/assign-rfid', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const parsed = assignRFIDSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { pass_id, rfid_uid_hash } = parsed.data;

    const updated = await queryOne(
      `UPDATE visitor_passes
       SET rfid_uid_hash = $1
       WHERE id = $2 AND community_id = $3 AND status = 'active'
       RETURNING *`,
      [rfid_uid_hash, pass_id, user.community_id]
    );

    if (!updated) {
      return error(res, 'Pass not found or not active', 404);
    }

    return success(res, updated);
  } catch (err) {
    console.error('POST /passes/assign-rfid error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
