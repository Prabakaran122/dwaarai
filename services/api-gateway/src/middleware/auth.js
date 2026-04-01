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
