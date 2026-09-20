import jwt from 'jsonwebtoken';

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
export function authenticateJWT(roles = []) {
  return (req, res, next) => {
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
          (r) => r === role || (r === 'admin' && (role === 'super_admin' || role === 'community_admin'))
        );
        if (!ok) return res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
      }

      // A super_admin inspecting one community, matching api-gateway's behaviour.
      if (decoded.role === 'super_admin' && req.headers['x-community-id']) {
        req.user.community_id = req.headers['x-community-id'];
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
