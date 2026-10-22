import jwt from 'jsonwebtoken';
import pool, { queryOne } from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-only-secret' : '');
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

/**
 * Whether a staff member's token still speaks for somebody allowed to work.
 *
 * A JWT is good until it expires, which for a guard is up to an hour after
 * sign-in. Deactivating a valet (DELETE /admin/staff/:id) or a temporary
 * driver's valet_until passing therefore changed nothing for that hour -- the
 * person let go at the start of a shift could still accept a retrieval and
 * hand somebody's car over. api-gateway refuses them at login and refresh;
 * this refuses the token they already hold.
 *
 * Cached for a short while per person, because this runs on every request the
 * valet app makes and the app polls. Thirty seconds is the longest a revoked
 * token keeps working, against an hour before.
 */
const STAFF_CACHE_TTL_MS = 30 * 1000;
const staffCache = new Map();

/** Test seam: forget every cached answer. */
export function clearStaffCache() {
  staffCache.clear();
}

/**
 * true = may work, false = revoked, null = could not tell.
 *
 * Reads through the pool rather than queryOne so a failure here is told apart
 * from an answer: if the database cannot be reached, the route's own queries
 * fail the request anyway, and refusing every attendant at once over a
 * bookkeeping lookup would turn a blip into a porch with nobody able to work.
 */
async function staffMayWork(residentId) {
  const hit = staffCache.get(residentId);
  if (hit && hit.expires > Date.now()) return hit.ok;

  let result;
  try {
    result = await pool.query(
      `SELECT is_active, valet_until FROM residents WHERE id = $1 AND type = 'guard'`,
      [residentId]
    );
  } catch {
    return null;
  }
  if (!result || !Array.isArray(result.rows)) return null;

  const row = result.rows[0];
  // No row at all is a revocation too: a token naming a person who does not
  // exist (or is no longer staff) speaks for nobody.
  const ok = !!row
    && row.is_active !== false
    && !(row.valet_until && new Date(row.valet_until) <= new Date());
  staffCache.set(residentId, { ok, expires: Date.now() + STAFF_CACHE_TTL_MS });
  return ok;
}

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

      // Staff only. An admin token's sub is an admins row, not a resident, and
      // admins are revoked in api-gateway; the photo-link routes carry no
      // token at all and never reach this.
      if (decoded.role === 'guard' && decoded.sub) {
        const ok = await staffMayWork(decoded.sub);
        if (ok === false) {
          return res.status(401).json({
            error: 'staff_inactive',
            message: 'This account has been deactivated or has expired',
          });
        }
      }

      next();
    } catch {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
  };
}
