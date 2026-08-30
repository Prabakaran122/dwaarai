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
 */

let io = null;

export function initRealtime(httpServer) {
  // Imported lazily so `vitest` and any non-listening import never construct a
  // socket server; tests exercise emit() with io still null.
  return import('socket.io').then(({ Server }) => {
    io = new Server(httpServer, {
      path: '/valet/socket.io',
      cors: { origin: process.env.CORS_ORIGIN?.split(',') || '*' },
    });

    io.on('connection', (socket) => {
      // A guest joins only their own ticket room, keyed by the session token
      // they already hold. Knowing a token is what grants access to that
      // ticket over HTTP too, so this adds no new exposure.
      socket.on('join:ticket', (sessionToken) => {
        if (typeof sessionToken === 'string' && sessionToken.length >= 16) {
          socket.join(`ticket:${sessionToken}`);
        }
      });
      socket.on('join:community', (communityId) => {
        if (typeof communityId === 'string') socket.join(`community:${communityId}`);
      });
    });

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
