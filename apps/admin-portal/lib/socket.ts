import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
// Strip /api/v1 suffix if present — Socket.io connects to the root
const SOCKET_URL = API_BASE.replace(/\/api\/v1\/?$/, '');
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || process.env.ADMIN_JWT_TOKEN || '';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: { token: ADMIN_TOKEN },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('Socket.io connected');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket.io connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
