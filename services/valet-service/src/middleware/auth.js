import jwt from 'jsonwebtoken';
import { queryOne } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-only-secret' : '');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it before starting the server.');
}

/**
 * Same token contract as api-gateway: guards sign in via
 * POST /auth/guard-login there and present the resulting JWT here.
 *
 * This replaces the prototype's guard "session", which was a name in a signed
 * cookie — attribution only, never access control. Every guard action in this
 * service is now tied to a real residents(id) with a real community.
 */
/**
 * Everyone who administers a property, at any scope.
 *
 * client_admin spans an account of several properties; community_admin holds
 * one. Both are administrators, and a route that asks for 'admin' means the
 * job rather than the scope -- the scope is enforced by which community the
 * token carries.
 */
const ADMIN_ROLES = ['super_admin', 'client_admin', 'community_admin'];

export function authenticateJWT(roles = []) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
    }
    try {
      const decoded = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = decoded;

      if (roles.length) {
        const role = decoded.role;
        const ok = roles.some(
          (r) => r === role || (r === 'admin' && ADMIN_ROLES.includes(role))
        );
        if (!ok) return res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
      }

      // A super_admin inspecting one community, matching api-gateway's behaviour.
      if (decoded.role === 'super_admin' && req.headers['x-community-id']) {
        req.user.community_id = req.headers['x-community-id'];
      }

      // A client_admin holds an account of several properties and no single
      // one, so demanding a community from their token locked them out of the
      // very endpoint built for them. They may name a property instead -- but
      // only one of their own: taking the header on trust would hand anybody
      // with a group login somebody else's hotel.
      if (decoded.role === 'client_admin' && decoded.account_id) {
        const asked = req.headers['x-community-id'];
        if (asked) {
          const owned = await queryOne(
            'SELECT id FROM communities WHERE id = $1 AND account_id = $2',
            [asked, decoded.account_id]
          );
          if (!owned) {
            return res.status(403).json({
              error: 'not_your_property',
              message: 'That property is not in this account',
            });
          }
          req.user.community_id = asked;
        }
        // No header: account-scoped routes read account_id and need nothing
        // more. Community-scoped ones still find no community and say so.
        return next();
      }

      if (!req.user.community_id) {
        return res.status(403).json({ error: 'no_community', message: 'Token carries no community' });
      }

      next();
    } catch {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
  };
}
