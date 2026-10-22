/**
 * Live ticket updates.
 *
 * The prototype polled every 4s on both the guest and the guard side, and
 * marked each poll loop as the place a push channel would go. This is that
 * channel: a Socket.IO server on the valet service, rooms scoped per
 * community (guard/ops views) and per ticket (one guest's page).
 *
 * Clients keep their poll as a fallback, so a blocked websocket degrades to
 * the prototype's behaviour rather than a dead screen.
 *
 * A community room carries every ticket at a venue, so it is staff-only: the
 * handshake must present the same JWT the HTTP routes take (auth.token, or an
 * Authorization: Bearer header) and may join only the community that token
 * is for. It used to be open to anyone who knew the venue's id -- which is
 * printed in every card's QR.
 */

import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';
import { queryOne } from '../db.js';

let io = null;

// Mirrors the roles the guard and admin routes accept. A resident's token is
// signed with the same secret and carries a community too, so "verifies" is
// not enough on its own.
const STAFF_ROLES = ['guard', 'super_admin', 'client_admin', 'community_admin'];

/** The staff identity a handshake proves, or null. Never throws. */
export function socketUser(handshake = {}) {
  const header = handshake.headers?.authorization;
  const raw = handshake.auth?.token
    || (typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!raw || typeof raw !== 'string') return null;
  try {
    const decoded = jwt.verify(raw, JWT_SECRET);
    return STAFF_ROLES.includes(decoded?.role) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Whether this user may watch this venue. Same scoping as authenticateJWT:
 * a super_admin may inspect any community, a client_admin any in their own
 * account, and everybody else only the one in their token.
 */
export async function mayJoinCommunity(user, communityId) {
  if (!user || typeof communityId !== 'string' || !communityId) return false;
  if (user.role === 'super_admin') return true;
  if (user.community_id && user.community_id === communityId) return true;
  if (user.role === 'client_admin' && user.account_id) {
    const owned = await queryOne(
      'SELECT id FROM communities WHERE id = $1 AND account_id = $2',
      [communityId, user.account_id]
    ).catch(() => null);
    return !!owned;
  }
  return false;
}

/**
 * Wires one connection. Exported so the room rules can be tested without
 * standing up a socket server.
 */
export function onConnection(socket) {
  // Verified once, at the handshake. A token that expires mid-connection keeps
  // the rooms it already joined until the socket drops, the same as an HTTP
  // poll that started a second before expiry.
  const user = socketUser(socket.handshake);

  // A guest joins only their own ticket room, keyed by the session token
  // they already hold. Knowing a token is what grants access to that
  // ticket over HTTP too, so this adds no new exposure.
  socket.on('join:ticket', (sessionToken) => {
    if (typeof sessionToken === 'string' && sessionToken.length >= 16) {
      socket.join(`ticket:${sessionToken}`);
    }
  });

  // The ack is optional; a client that passes one learns why it was refused
  // instead of waiting on a room that will never speak.
  socket.on('join:community', async (communityId, ack) => {
    const ok = await mayJoinCommunity(user, communityId);
    if (ok) socket.join(`community:${communityId}`);
    if (typeof ack === 'function') ack(ok ? { ok: true } : { ok: false, error: user ? 'forbidden' : 'unauthorized' });
  });
}

export function initRealtime(httpServer) {
  // Imported lazily so `vitest` and any non-listening import never construct a
  // socket server; tests exercise emit() with io still null.
  return import('socket.io').then(({ Server }) => {
    io = new Server(httpServer, {
      path: '/valet/socket.io',
      // Same rule as the HTTP CORS in index.js: unset is permissive only off
      // production. A production box with no CORS_ORIGIN refuses cross-origin
      // sockets rather than accepting every site.
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim())
          || (process.env.NODE_ENV === 'production' ? false : '*'),
      },
    });

    io.on('connection', onConnection);

    return io;
  });
}

export function getIO() {
  return io;
}

/** No-ops when realtime was never initialised, so routes need no guard. */
export function emitTicketUpdate(ticket) {
  if (!io || !ticket) return;
  io.to(`ticket:${ticket.session_token}`).emit('ticket:update', { sessionToken: ticket.session_token, status: ticket.status });
  io.to(`community:${ticket.community_id}`).emit('valet:ticket', { id: ticket.id, status: ticket.status });
}
