import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
// Strip /api/v1 suffix if present — Socket.io connects to the root
const SOCKET_URL = API_BASE.replace(/\/api\/v1\/?$/, '');
let socket: Socket | null = null;
// What the live socket was opened with, so a login or a community switch can be
// detected and the connection rebuilt rather than left following the old room.
let openedWith = { token: '', communityId: '' };

/**
 * Credentials for the socket handshake.
 *
 * These come from localStorage — the same place lib/api.ts reads them — NOT from
 * a build-time env var. The previous NEXT_PUBLIC_ADMIN_TOKEN predates login and
 * was never set in any build, so the socket always handshook with an empty token,
 * the server rejected it, and the live feed silently never connected.
 */
function currentAuth() {
  if (typeof window === 'undefined') return { token: '', communityId: '' };
  return {
    token: localStorage.getItem('cg_admin_token') || '',
    // Only a super_admin's choice is honoured server-side; for anyone else the
    // server ignores this and uses their own token's community.
    communityId: localStorage.getItem('cg_selected_community_id') || '',
  };
}

export function getSocket(): Socket {
  const auth = currentAuth();

  // Reuse the connection only if it was opened with the same identity.
  if (socket) {
    if (auth.token === openedWith.token && auth.communityId === openedWith.communityId) {
      return socket;
    }
    socket.disconnect();
    socket = null;
  }

  openedWith = auth;
  socket = io(SOCKET_URL, {
    auth: { token: auth.token, communityId: auth.communityId },
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
    openedWith = { token: '', communityId: '' };
  }
}
