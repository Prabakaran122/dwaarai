import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.in/api/v1';
const SOCKET_URL = API_BASE.replace(/\/api\/v1\/?$/, '');

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  // Disconnect existing before reconnecting
  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('Guard socket connected');
  });

  socket.on('connect_error', (err: Error) => {
    console.error('Guard socket error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
