import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { queryOne } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { getRedisClient } from '../db/redis.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-only-secret' : '');
const TOKEN_EXPIRY = '24h';

// -- Rate limiters for login endpoints ----------------------------------------

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many login attempts, please try again later' } },
});

// -- Zod schemas --------------------------------------------------------------

const guardLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const residentOtpSchema = z.object({
  phone: z.string().min(10).max(15),
});

const residentVerifySchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});

const adminLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const residentRegisterSchema = z.object({
  community_code: z.string().min(1).max(20),
  phone: z.string().min(10).max(15),
  unit_number: z.string().min(1).max(30),
});

const residentRegisterVerifySchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});

// -- Helper: sign JWT ---------------------------------------------------------

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// -- POST /auth/guard-login ---------------------------------------------------

router.post('/auth/guard-login', loginLimiter, async (req, res) => {
  try {
    const parsed = guardLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { username, password } = parsed.data;

    // In production, guards should use Cognito authentication
    if (process.env.NODE_ENV === 'production') {
      return error(res, 'Use Cognito authentication in production', 400);
    }

    // Dev/MVP mode: look up a resident with type='guard' matching by name or mobile
    // First try by name (case-insensitive), then by mobile
    let guard = await queryOne(
      `SELECT r.id, r.community_id, r.unit_id, r.name, r.mobile, r.type,
              g.id AS gate_id
       FROM residents r
       LEFT JOIN gates g ON g.community_id = r.community_id AND g.is_active = true
       WHERE r.is_active = true
         AND r.type = 'guard'
         AND (LOWER(r.name) = LOWER($1) OR r.mobile = $1)
       LIMIT 1`,
      [username]
    );

    // Fallback: hardcoded dev guard if no guard found in DB
    if (!guard) {
      if (username === 'guard1' && password === 'guard123') {
        const token = signToken({
          sub: '00000000-0000-0000-0000-000000000000',
          role: 'guard',
          community_id: '00000000-0000-0000-0000-000000000001',
          gate_id: '00000000-0000-0000-0000-000000100001',
          name: 'Dev Guard',
        });

        return success(res, {
          token,
          user: {
            name: 'Dev Guard',
            role: 'guard',
            gateId: '00000000-0000-0000-0000-000000100001',
          },
        });
      }

      return error(res, 'Invalid credentials', 401);
    }

    // In dev mode, accept any password for DB guards
    // (no password column exists in residents table)
    const token = signToken({
      sub: guard.id,
      role: 'guard',
      community_id: guard.community_id,
      gate_id: guard.gate_id || null,
      name: guard.name,
    });

    return success(res, {
      token,
      user: {
        name: guard.name,
        role: 'guard',
        gateId: guard.gate_id || null,
      },
    });
  } catch (err) {
    console.error('POST /auth/guard-login error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-otp -------------------------------------------------

router.post('/auth/resident-otp', loginLimiter, async (req, res) => {
  try {
    const parsed = residentOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone } = parsed.data;

    // Verify resident exists
    const resident = await queryOne(
      'SELECT id FROM residents WHERE mobile = $1 AND is_active = true',
      [phone]
    );
    if (!resident) {
      // Return generic message to avoid phone enumeration
      return success(res, { message: 'OTP sent' });
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    // Store in Redis with 5-minute TTL
    const redis = getRedisClient();
    await redis.set(`otp:${phone}`, otp, 'EX', 300);

    // In production, send OTP via SMS (Twilio, SNS, etc.)
    // For dev, log it
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${phone}: ${otp}`);
    }

    return success(res, { message: 'OTP sent' });
  } catch (err) {
    console.error('POST /auth/resident-otp error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-verify ----------------------------------------------

router.post('/auth/resident-verify', loginLimiter, async (req, res) => {
  try {
    const parsed = residentVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone, otp } = parsed.data;

    // Retrieve OTP from Redis
    const redis = getRedisClient();
    const storedOtp = await redis.get(`otp:${phone}`);

    if (!storedOtp || storedOtp !== otp) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    // Delete OTP after successful verification
    await redis.del(`otp:${phone}`);

    // Look up resident
    const resident = await queryOne(
      `SELECT r.id, r.community_id, r.unit_id, r.name, r.mobile,
              u.unit_number
       FROM residents r
       JOIN units u ON r.unit_id = u.id
       WHERE r.mobile = $1 AND r.is_active = true`,
      [phone]
    );

    if (!resident) {
      return error(res, 'Resident not found', 404);
    }

    const token = signToken({
      sub: resident.id,
      role: 'resident',
      community_id: resident.community_id,
      unit_id: resident.unit_id,
      name: resident.name,
    });

    return success(res, {
      token,
      user: {
        id: resident.id,
        name: resident.name,
        phone: resident.mobile,
        unitNumber: resident.unit_number,
      },
    });
  } catch (err) {
    console.error('POST /auth/resident-verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-register -------------------------------------------

router.post('/auth/resident-register', loginLimiter, async (req, res) => {
  try {
    const parsed = residentRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { community_code, phone, unit_number } = parsed.data;

    // Find community by invite_code (case-insensitive)
    const community = await queryOne(
      'SELECT id, name FROM communities WHERE invite_code = $1 AND is_active = true',
      [community_code.toUpperCase()]
    );
    if (!community) {
      return error(res, 'Invalid community code', 400);
    }

    // Find unit in community
    const unit = await queryOne(
      'SELECT id, unit_number, block_id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community.id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found in this community', 400);
    }

    // Check phone not already registered
    const existing = await queryOne(
      'SELECT id FROM residents WHERE community_id = $1 AND mobile = $2 AND is_active = true',
      [community.id, phone]
    );
    if (existing) {
      return error(res, 'Phone number already registered', 409);
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    // Store registration data in Redis with 5-minute TTL
    const redis = getRedisClient();
    await redis.set(
      `reg:${phone}`,
      JSON.stringify({
        otp,
        community_id: community.id,
        community_name: community.name,
        unit_id: unit.id,
        unit_number: unit.unit_number,
      }),
      'EX',
      300
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Registration OTP for ${phone}: ${otp}`);
    }

    return success(res, { message: 'OTP sent', communityName: community.name });
  } catch (err) {
    console.error('POST /auth/resident-register error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-register-verify ------------------------------------

router.post('/auth/resident-register-verify', loginLimiter, async (req, res) => {
  try {
    const parsed = residentRegisterVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone, otp } = parsed.data;

    // Retrieve registration data from Redis
    const redis = getRedisClient();
    const raw = await redis.get(`reg:${phone}`);
    if (!raw) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    const regData = JSON.parse(raw);
    if (regData.otp !== otp) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    // Delete Redis key after successful verification
    await redis.del(`reg:${phone}`);

    const { community_id, community_name, unit_id, unit_number } = regData;

    // Double-check no duplicate resident was created in the meantime
    const duplicate = await queryOne(
      'SELECT id FROM residents WHERE community_id = $1 AND mobile = $2 AND is_active = true',
      [community_id, phone]
    );
    if (duplicate) {
      return error(res, 'Phone number already registered', 409);
    }

    // Create the resident record
    const resident = await queryOne(
      `INSERT INTO residents (community_id, unit_id, name, mobile, type, is_primary)
       VALUES ($1, $2, 'Resident', $3, 'owner', false)
       RETURNING id, community_id, unit_id, name, mobile`,
      [community_id, unit_id, phone]
    );

    const token = signToken({
      sub: resident.id,
      role: 'resident',
      community_id: resident.community_id,
      unit_id: resident.unit_id,
      name: resident.name,
    });

    return res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: resident.id,
          name: resident.name,
          phone: resident.mobile,
          unitNumber: unit_number,
          communityName: community_name,
        },
      },
    });
  } catch (err) {
    console.error('POST /auth/resident-register-verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/admin-login -------------------------------------------------

router.post('/auth/admin-login', loginLimiter, async (req, res) => {
  try {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { username, password } = parsed.data;

    const admin = await queryOne(
      'SELECT id, name, username, password_hash, role, community_id FROM admins WHERE username = $1 AND is_active = true',
      [username]
    );

    if (!admin) {
      return error(res, 'Invalid credentials', 401);
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      return error(res, 'Invalid credentials', 401);
    }

    const token = signToken({
      sub: admin.id,
      role: admin.role,
      community_id: admin.community_id || null,
      name: admin.name,
    });

    return success(res, {
      token,
      user: {
        id: admin.id,
        name: admin.name,
        role: admin.role,
        communityId: admin.community_id || null,
      },
    });
  } catch (err) {
    console.error('POST /auth/admin-login error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
