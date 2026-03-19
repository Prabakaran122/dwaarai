import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, queryRows } from './db.js';
import { generateOTP, sendOTPViaSMS } from './otp.js';

const router = Router();

// -- Response helpers --------------------------------------------------------

function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

function error(res, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: { message, details },
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

// -- Zod schemas -------------------------------------------------------------

const createPassSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  visitor_mobile: z.string().min(7).max(15).optional(),
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

// -- POST /passes  (JWT resident) --------------------------------------------

router.post('/passes', async (req, res) => {
  try {
    const parsed = createPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, visitor_mobile, valid_from, valid_until, max_uses } = parsed.data;
    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const created_by = user.sub;

    const otp = generateOTP(6);

    const pass = await queryOne(
      `INSERT INTO visitor_passes
         (community_id, unit_id, created_by, visitor_name, visitor_mobile, otp, valid_from, valid_until, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [community_id, unit_id, created_by, visitor_name, visitor_mobile || null, otp, valid_from, valid_until, max_uses]
    );

    // Send OTP via SMS (mock in dev)
    let smsSent = false;
    if (visitor_mobile) {
      const smsResult = await sendOTPViaSMS(visitor_mobile, otp, visitor_name);
      smsSent = smsResult.success;
      if (smsSent) {
        await query('UPDATE visitor_passes SET sms_sent = true WHERE id = $1', [pass.id]);
        pass.sms_sent = true;
      }
    }

    return success(res, pass, 201);
  } catch (err) {
    console.error('POST /passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /passes  (JWT resident|admin) ---------------------------------------

router.get('/passes', async (req, res) => {
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

    return success(res, { passes: data, nextCursor });
  } catch (err) {
    console.error('GET /passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /passes/:id  (JWT resident) --------------------------------------

router.delete('/passes/:id', async (req, res) => {
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

// -- POST /passes/verify  (Device token) ------------------------------------

router.post('/passes/verify', async (req, res) => {
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

    // Increment uses_count
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

// -- POST /passes/assign-rfid  (JWT admin) ----------------------------------

router.post('/passes/assign-rfid', async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

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
