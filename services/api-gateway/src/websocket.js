import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

// Validated before it is interpolated into a room name, so a client cannot
// craft a room string.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let io = null;

/**
 * Decide which community's room a socket may follow.
 *
 * A super_admin has no community_id of its own, so without an override it lands
 * in `community:undefined` and receives nothing — the live feed was silently
 * dead for exactly the account used to demo it. This mirrors the REST layer's
 * X-Community-Id override (middleware/auth.js): a super_admin may follow any
 * community; everyone else is pinned to their own token's community no matter
 * what the client asks for.
 *
 * Returns null when there is no community to follow, so the caller can refuse
 * the connection rather than join a room that can never receive anything.
 */
export function resolveRoomCommunity(user, requested) {
  if (user?.role === 'super_admin' && UUID_RE.test(String(requested ?? ''))) {
    return requested;
  }
  return user?.community_id ?? null;
}

export function initWebSocket(httpServer, corsOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // JWT auth middleware — verify token on connection handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing auth token'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;

    const communityId = resolveRoomCommunity(user, socket.handshake.auth?.communityId);

    if (!communityId) {
      // No room to join means every emit would be dropped silently. Fail loudly
      // instead, so a misconfigured client is visible rather than merely quiet.
      console.warn(`Socket rejected: ${user.name} (${user.role}) has no community to follow`);
      return socket.disconnect(true);
    }

    const room = `community:${communityId}`;
    socket.join(room);
    console.log(`Socket connected: ${user.name} (${user.role}) joined ${room}`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user.name} (${user.role})`);
    });
  });

  console.log('WebSocket server initialized');
  return io;
}

export function broadcast(communityId, eventType, payload) {
  if (!io) return;
  io.to(`community:${communityId}`).emit(eventType, payload);
}

export function getIO() {
  return io;
}
