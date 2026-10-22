import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { getRedisClient } from '../db/redis.js';
import { isConfigured as msg91Configured, sendOTP as msg91Send, verifyOTP as msg91Verify } from '../lib/msg91.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-only-secret' : '');
if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error('JWT_SECRET environment variable is required');
}
const TOKEN_EXPIRY = '1h';
const REFRESH_EXPIRY = '7d';

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRY });
}

// -- Rate limiters for login endpoints ----------------------------------------
//
// Two layers, because one bucket per IP is the wrong shape in both directions.
// Behind nginx every request used to arrive from 127.0.0.1, so a single 5/min
// bucket was shared by every guard, admin and resident on the platform: one
// person mistyping a password five times locked everybody else out. Keying on
// the identity being attacked (plus the caller's IP, now real thanks to
// `trust proxy` in index.js) keeps one user's failures in their own bucket.
//
// The identity bucket alone would let one IP try 5 passwords against every
// username in turn, so a looser per-IP bucket sits in front of it to stop
// spraying. Both answer with the same 429 body the apps already handle.

const RATE_LIMIT_MESSAGE = { success: false, error: { message: 'Too many login attempts, please try again later' } };

function identityLimiter(label, pickIdentity) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => `${label}:${pickIdentity(req.body || {})}:${req.ip}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMIT_MESSAGE,
  });
}

// Usernames are compared case-insensitively at lookup, so "Ravi" and "ravi"
// must share a bucket or an attacker gets 5 tries per capitalisation.
const byUsername = (body) => String(body.username ?? '').trim().toLowerCase();
const byPhone = (body) => String(body.phone ?? '').trim();

const loginIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `login-ip:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

const guardLoginLimiter = identityLimiter('guard-login', byUsername);
const adminLoginLimiter = identityLimiter('admin-login', byUsername);
const residentOtpLimiter = identityLimiter('resident-otp', byPhone);
const residentVerifyLimiter = identityLimiter('resident-verify', byPhone);
const residentRegisterLimiter = identityLimiter('resident-register', byPhone);
const residentRegisterVerifyLimiter = identityLimiter('resident-register-verify', byPhone);

// -- Dev OTP helpers ------------------------------------------------------------
//
// The master OTP is a backdoor into every resident account, so it needs an
// explicit opt-in rather than being implied by "MSG91 is not configured". The
// production api-gateway unit written by deploy/setup-server.sh sets
// NODE_ENV=development, so NODE_ENV alone cannot be trusted to keep it off:
// ALLOW_DEV_MASTER_OTP=true must be set deliberately, and NODE_ENV=production
// still vetoes it in case both end up on a real box.
export function devMasterOtp() {
  if (process.env.ALLOW_DEV_MASTER_OTP !== 'true') return null;
  if (process.env.NODE_ENV === 'production') return null;
  return process.env.DEV_MASTER_OTP || null;
}

if (devMasterOtp() && process.env.NODE_ENV !== 'test') {
  console.warn(
    '!!! WARNING: DEV MASTER OTP IS ENABLED (ALLOW_DEV_MASTER_OTP=true). ' +
    'Anyone who knows it can sign in as any resident when MSG91 is not configured. ' +
    'Never set this on a server reachable from the internet. !!!'
  );
}

// Logs end up in journald and log shippers that far more people can read
// than can read the database. A phone number is personal data under DPDP and,
// paired with an OTP, a working login -- so OTPs are never logged and phones
// only by their last four digits.
export function maskPhone(phone) {
  const s = String(phone ?? '');
  return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

// -- Staff revocation ----------------------------------------------------------
//
// A guard/valet row stops being able to sign in (or keep a session going by
// refreshing) the moment it is deactivated, or once a temporary driver's
// valet_until has passed. Checked in code as well as in SQL so the refresh path,
// which has to look the row up regardless to tell "revoked" from "unknown",
// applies exactly the same rule as login.
function staffIsRevoked(row, now = new Date()) {
  if (row.is_active === false) return true;
  if (row.valet_until && new Date(row.valet_until) <= now) return true;
  return false;
}

// The one gate a guard is stationed at. A community can have several active
// gates; a LATERAL pick keeps the staff lookup one row per person instead of
// one row per (person, gate), which matters now that login considers every
// matching row rather than the first.
const GUARD_GATE_JOIN = `LEFT JOIN LATERAL (
         SELECT id, name FROM gates
         WHERE community_id = r.community_id AND is_active = true
         ORDER BY created_at, id
         LIMIT 1
       ) g ON true`;

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

// One builder per kind of token, shared by login and /auth/refresh. Refresh
// used to hand-roll its own payload and drifted: it dropped account_id, so a
// Client Admin was 403 no_community an hour after signing in, and gave guards
// unit_id instead of gate_id. Any claim added here reaches both paths.
function guardClaims(row) {
  return {
    sub: row.id,
    role: 'guard',
    community_id: row.community_id,
    gate_id: row.gate_id || null,
    name: row.name,
  };
}

function residentClaims(row) {
  return {
    sub: row.id,
    role: 'resident',
    community_id: row.community_id,
    unit_id: row.unit_id,
    name: row.name,
    is_committee: row.is_committee || false,
  };
}

function adminClaims(row) {
  return {
    sub: row.id,
    role: row.role,
    community_id: row.community_id || null,
    // A Client Admin is scoped by account the way a Location Manager is
    // scoped by community. valet-service reads this to decide which
    // properties they may see; without it every group admin is told their
    // account holds a single property.
    account_id: row.account_id || null,
    name: row.name,
  };
}

// -- POST /auth/guard-login ---------------------------------------------------

router.post('/auth/guard-login', loginIpLimiter, guardLoginLimiter, async (req, res) => {
  try {
    const parsed = guardLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { username, password } = parsed.data;

    // Every active guard whose name or mobile matches, across all communities.
    // This used to be LIMIT 1, so two attendants called "Ravi" at different
    // hotels collided: whichever row Postgres returned first was the only one
    // whose password was ever tried, and the other Ravi could never sign in.
    const candidates = await queryRows(
      `SELECT r.id, r.community_id, r.unit_id, r.name, r.mobile, r.type,
              r.password_hash, r.preferred_language, r.is_active, r.valet_until,
              c.config AS community_config, c.name AS community_name,
              g.id AS gate_id, g.name AS gate_name
       FROM residents r
       JOIN communities c ON c.id = r.community_id
       ${GUARD_GATE_JOIN}
       WHERE r.is_active = true
         AND r.type = 'guard'
         AND (r.valet_until IS NULL OR r.valet_until > NOW())
         AND (LOWER(r.name) = LOWER($1) OR r.mobile = $1)`,
      [username]
    );

    // A mobile number is unique to a person; a name is not. If the username
    // is somebody's mobile, only those rows are in play -- otherwise a guard
    // whose *name* happened to be that string could shadow them.
    let pool = (candidates || []).filter((r) => !staffIsRevoked(r));
    const byMobile = pool.filter((r) => r.mobile === username);
    if (byMobile.length) pool = byMobile;

    if (!pool.length) {
      return error(res, 'Invalid credentials', 401);
    }

    // Guards must have a password set. Only report that when no match has
    // one, so an unconfigured namesake cannot block a configured guard.
    const withPassword = pool.filter((r) => r.password_hash);
    if (!withPassword.length) {
      return error(res, 'Guard account not configured. Contact admin to set a password.', 403);
    }

    const verified = [];
    for (const row of withPassword) {
      if (await bcrypt.compare(password, row.password_hash)) verified.push(row);
    }

    if (verified.length === 0) {
      return error(res, 'Invalid credentials', 401);
    }
    if (verified.length > 1) {
      // Two namesakes sharing a password: picking either would sign one of
      // them into the other's property. Make them disambiguate instead.
      return error(res, 'More than one staff account matches this name. Please log in with your mobile number.', 401);
    }

    const guard = verified[0];

    const token = signToken(guardClaims(guard));

    const refreshToken = signRefreshToken(guard.id);
    // Language: guard's saved preference → society default (communities.config) → 'en'.
    const societyDefault = guard.community_config?.default_language;
    const language = guard.preferred_language || societyDefault || 'en';
    return success(res, {
      token,
      refreshToken,
      user: {
        name: guard.name,
        role: 'guard',
        gateId: guard.gate_id || null,
        gateName: guard.gate_name || null,
        communityName: guard.community_name || null,
        language,
      },
    });
  } catch (err) {
    console.error('POST /auth/guard-login error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-otp -------------------------------------------------

router.post('/auth/resident-otp', loginIpLimiter, residentOtpLimiter, async (req, res) => {
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

    if (msg91Configured()) {
      await msg91Send(phone);
    } else {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const redis = getRedisClient();
      await redis.set(`otp:${phone}`, otp, 'EX', 300);
      // Never the OTP itself: read it from Redis (otp:<phone>) or use the
      // dev master OTP when ALLOW_DEV_MASTER_OTP is on.
      console.log(`[DEV] OTP stored in Redis for ${maskPhone(phone)} (MSG91 not configured)`);
    }

    return success(res, { message: 'OTP sent' });
  } catch (err) {
    console.error('POST /auth/resident-otp error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-verify ----------------------------------------------

router.post('/auth/resident-verify', loginIpLimiter, residentVerifyLimiter, async (req, res) => {
  try {
    const parsed = residentVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone, otp } = parsed.data;

    let otpValid = false;
    if (msg91Configured()) {
      otpValid = await msg91Verify(phone, otp);
    } else {
      // Dev-only master OTP bypass. Active ONLY when real SMS is not
      // configured AND devMasterOtp() allows it (see the comment there).
      const master = devMasterOtp();
      if (master && otp === master) {
        otpValid = true;
      } else {
        const redis = getRedisClient();
        const storedOtp = await redis.get(`otp:${phone}`);
        otpValid = !!(storedOtp && storedOtp === otp);
        if (otpValid) await redis.del(`otp:${phone}`);
      }
    }

    if (!otpValid) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    // Look up resident
    const resident = await queryOne(
      `SELECT r.id, r.community_id, r.unit_id, r.name, r.mobile, r.is_committee,
              u.unit_number
       FROM residents r
       JOIN units u ON r.unit_id = u.id
       WHERE r.mobile = $1 AND r.is_active = true`,
      [phone]
    );

    if (!resident) {
      return error(res, 'Resident not found', 404);
    }

    const token = signToken(residentClaims(resident));

    const refreshToken = signRefreshToken(resident.id);
    return success(res, {
      token,
      refreshToken,
      user: {
        id: resident.id,
        name: resident.name,
        phone: resident.mobile,
        unitNumber: resident.unit_number,
        isCommittee: resident.is_committee || false,
      },
    });
  } catch (err) {
    console.error('POST /auth/resident-verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-register -------------------------------------------

router.post('/auth/resident-register', loginIpLimiter, residentRegisterLimiter, async (req, res) => {
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

    // Store registration context in Redis (WITHOUT OTP when using MSG91)
    const redis = getRedisClient();
    if (msg91Configured()) {
      await redis.set(
        `reg:${phone}`,
        JSON.stringify({
          community_id: community.id,
          community_name: community.name,
          unit_id: unit.id,
          unit_number: unit.unit_number,
        }),
        'EX',
        300
      );
      await msg91Send(phone);
    } else {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
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
      console.log(`[DEV] Registration OTP stored in Redis for ${maskPhone(phone)} (MSG91 not configured)`);
    }

    return success(res, { message: 'OTP sent', communityName: community.name });
  } catch (err) {
    console.error('POST /auth/resident-register error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/resident-register-verify ------------------------------------

router.post('/auth/resident-register-verify', loginIpLimiter, residentRegisterVerifyLimiter, async (req, res) => {
  try {
    const parsed = residentRegisterVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone, otp } = parsed.data;

    // Retrieve registration context from Redis
    const redis = getRedisClient();
    const raw = await redis.get(`reg:${phone}`);
    if (!raw) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    const regData = JSON.parse(raw);

    // Verify OTP via MSG91 or Redis fallback
    let otpValid = false;
    if (msg91Configured()) {
      otpValid = await msg91Verify(phone, otp);
    } else {
      // Dev-only master OTP bypass (see devMasterOtp()).
      const master = devMasterOtp();
      otpValid = !!((master && otp === master) || (regData.otp && regData.otp === otp));
    }

    if (!otpValid) {
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
      is_committee: false, // freshly created residents are never committee members
    });

    const refreshToken = signRefreshToken(resident.id);
    return res.status(201).json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: resident.id,
          name: resident.name,
          phone: resident.mobile,
          unitNumber: unit_number,
          communityName: community_name,
          isCommittee: false,
        },
      },
    });
  } catch (err) {
    console.error('POST /auth/resident-register-verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/refresh -------------------------------------------------------

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return error(res, 'Refresh token required', 400);
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    if (decoded.type !== 'refresh') {
      return error(res, 'Invalid token type', 401);
    }

    // Check if token is blacklisted (logged out)
    const redis = getRedisClient();
    const blacklisted = await redis.get(`bl:${refreshToken}`);
    if (blacklisted) {
      return error(res, 'Token has been revoked', 401);
    }

    // Look up user by ID to get current data. Not filtered on is_active: a
    // deactivated user must get a 401 (the apps sign out on it) rather than
    // fall through to "not found", and every claim is re-read so a change
    // made since login (a new gate, committee membership) takes effect.
    const resident = await queryOne(
      `SELECT r.id, r.community_id, r.unit_id, r.name, r.mobile, r.type,
              r.is_active, r.valet_until, r.is_committee,
              g.id AS gate_id
       FROM residents r
       ${GUARD_GATE_JOIN}
       WHERE r.id = $1`,
      [decoded.sub]
    );

    if (resident) {
      if (staffIsRevoked(resident)) {
        return error(res, 'Account is no longer active', 401);
      }
      const claims = resident.type === 'guard' ? guardClaims(resident) : residentClaims(resident);
      const token = signToken(claims);
      const newRefreshToken = signRefreshToken(resident.id);
      return success(res, { token, refreshToken: newRefreshToken });
    }

    // Try admins table -- the same columns admin-login signs from.
    const admin = await queryOne(
      'SELECT id, name, role, community_id, account_id, is_active FROM admins WHERE id = $1',
      [decoded.sub]
    );

    if (admin) {
      if (admin.is_active === false) {
        return error(res, 'Account is no longer active', 401);
      }
      const token = signToken(adminClaims(admin));
      const newRefreshToken = signRefreshToken(admin.id);
      return success(res, { token, refreshToken: newRefreshToken });
    }

    return error(res, 'User not found', 404);
  } catch (err) {
    console.error('POST /auth/refresh error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /auth/admin-login -------------------------------------------------

router.post('/auth/admin-login', loginIpLimiter, adminLoginLimiter, async (req, res) => {
  try {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { username, password } = parsed.data;

    const admin = await queryOne(
      'SELECT id, name, username, password_hash, role, community_id, account_id FROM admins WHERE username = $1 AND is_active = true',
      [username]
    );

    if (!admin) {
      return error(res, 'Invalid credentials', 401);
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      return error(res, 'Invalid credentials', 401);
    }

    const token = signToken(adminClaims(admin));

    const refreshToken = signRefreshToken(admin.id);
    return success(res, {
      token,
      refreshToken,
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

// -- POST /auth/logout --------------------------------------------------------

router.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      // Blacklist the refresh token in Redis for its remaining TTL
      try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          const redis = getRedisClient();
          await redis.set(`bl:${refreshToken}`, '1', 'EX', ttl);
        }
      } catch {
        // Token already expired or invalid — no need to blacklist
      }
    }
    return success(res, { message: 'Logged out' });
  } catch (err) {
    console.error('POST /auth/logout error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
