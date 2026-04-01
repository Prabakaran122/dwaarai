import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

let io = null;

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
    const room = `community:${user.community_id}`;
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
