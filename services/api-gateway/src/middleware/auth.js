import jwt from 'jsonwebtoken';
import { error } from './response.js';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-only-secret' : '');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it before starting the server.');
}

export function authenticateJWT(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return error(res, 'Missing or invalid Authorization header', 401);
    }
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      // Role checking: 'admin' role accepts both super_admin and community_admin
      if (roles.length) {
        const userRole = decoded.role;
        const hasRole = roles.some(r =>
          r === userRole ||
          (r === 'admin' && (userRole === 'super_admin' || userRole === 'community_admin'))
        );
        if (!hasRole) {
          return error(res, 'Insufficient permissions', 403);
        }
      }

      // For super_admin viewing a specific community, allow override via header
      if (decoded.role === 'super_admin' && req.headers['x-community-id']) {
        decoded.community_id = req.headers['x-community-id'];
      }

      next();
    } catch (err) {
      return error(res, 'Invalid or expired token', 401);
    }
  };
}

/**
 * Is this token an administrator of some kind?
 *
 * `admin` is a ROLE GROUP, not a stored role: admin-login puts the row's real
 * role in the JWT, which is `super_admin` or `community_admin` and never the
 * literal 'admin'. Route bodies that compared `user.role === 'admin'` therefore
 * matched no real admin and silently fell through to their resident branch —
 * that is why the vehicle and pass lists came back empty for every admin.
 * Use this instead of comparing the string.
 */
export function isAdminUser(user) {
  return (
    user?.role === 'admin' ||
    user?.role === 'community_admin' ||
    user?.role === 'super_admin'
  );
}

export function authenticateDevice(req, res, next) {
  const token = req.headers['x-device-token'];
  if (!token) {
    return error(res, 'Missing X-Device-Token header', 401);
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.device = decoded;
    next();
  } catch (err) {
    return error(res, 'Invalid device token', 401);
  }
}

export function generateTestToken(payload, expiresIn = '24h') {
  const secret = process.env.JWT_SECRET || 'test-only-secret';
  return jwt.sign(payload, secret, { expiresIn });
}
