import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import jwt from 'jsonwebtoken';
import { queryOne } from '../db.js';
import { socketUser, onConnection } from '../lib/realtime.js';
import { guardToken, adminToken, COMMUNITY_ID } from './helpers.js';

const OTHER = '99999999-9999-9999-9999-999999999999';

/** A stand-in socket: records handlers and joined rooms. */
function fakeSocket(handshake = {}) {
  const handlers = {};
  const rooms = [];
  return {
    handshake,
    rooms,
    on: (event, fn) => { handlers[event] = fn; },
    join: (room) => rooms.push(room),
    emit: async (event, ...args) => handlers[event](...args),
  };
}

async function joinCommunity(handshake, communityId) {
  const socket = fakeSocket(handshake);
  onConnection(socket);
  const ack = vi.fn();
  await socket.emit('join:community', communityId, ack);
  return { rooms: socket.rooms, ack: ack.mock.calls[0]?.[0] };
}

beforeEach(() => { queryOne.mockReset(); });

// A community room carries every ticket at a venue, and the venue's id is in
// every card's QR. It used to be joinable by anyone who asked.
describe('join:community', () => {
  it('refuses a socket with no token', async () => {
    const { rooms, ack } = await joinCommunity({}, COMMUNITY_ID);

    expect(rooms).toEqual([]);
    expect(ack).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('refuses a token signed with some other secret', async () => {
    const forged = jwt.sign({ role: 'guard', community_id: COMMUNITY_ID }, 'not-the-secret');

    const { rooms } = await joinCommunity({ auth: { token: forged } }, COMMUNITY_ID);

    expect(rooms).toEqual([]);
  });

  it('lets a guard into their own venue, via auth.token', async () => {
    const { rooms, ack } = await joinCommunity({ auth: { token: guardToken() } }, COMMUNITY_ID);

    expect(rooms).toEqual([`community:${COMMUNITY_ID}`]);
    expect(ack).toEqual({ ok: true });
  });

  it('accepts the token as an Authorization header too', async () => {
    const { rooms } = await joinCommunity(
      { headers: { authorization: `Bearer ${adminToken()}` } }, COMMUNITY_ID
    );

    expect(rooms).toEqual([`community:${COMMUNITY_ID}`]);
  });

  it('refuses a guard asking for a venue that is not theirs', async () => {
    const { rooms, ack } = await joinCommunity({ auth: { token: guardToken() } }, OTHER);

    expect(rooms).toEqual([]);
    expect(ack).toEqual({ ok: false, error: 'forbidden' });
  });

  it('refuses a resident token, which carries a community but is not staff', async () => {
    const { rooms } = await joinCommunity({ auth: { token: guardToken({ role: 'resident' }) } }, COMMUNITY_ID);

    expect(rooms).toEqual([]);
  });

  it('lets a client_admin into a property of their own account only', async () => {
    const token = adminToken({ role: 'client_admin', community_id: null, account_id: 'acc-1' });

    queryOne.mockResolvedValueOnce({ id: OTHER });
    const owned = await joinCommunity({ auth: { token } }, OTHER);
    expect(owned.rooms).toEqual([`community:${OTHER}`]);
    expect(queryOne.mock.calls[0][1]).toEqual([OTHER, 'acc-1']);

    queryOne.mockResolvedValueOnce(null);
    const foreign = await joinCommunity({ auth: { token } }, COMMUNITY_ID);
    expect(foreign.rooms).toEqual([]);
  });

  it('lets a super_admin inspect any venue', async () => {
    const token = adminToken({ role: 'super_admin' });

    const { rooms } = await joinCommunity({ auth: { token } }, OTHER);

    expect(rooms).toEqual([`community:${OTHER}`]);
  });
});

describe('join:ticket', () => {
  it('still needs no login: the session token is the credential', () => {
    const socket = fakeSocket({});
    onConnection(socket);

    socket.emit('join:ticket', 'a'.repeat(32));
    socket.emit('join:ticket', 'short');

    expect(socket.rooms).toEqual([`ticket:${'a'.repeat(32)}`]);
  });
});

describe('socketUser', () => {
  it('never throws on junk', () => {
    expect(socketUser(undefined)).toBeNull();
    expect(socketUser({ auth: { token: 42 } })).toBeNull();
    expect(socketUser({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });
});
