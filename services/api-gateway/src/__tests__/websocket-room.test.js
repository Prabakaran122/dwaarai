import { describe, it, expect } from 'vitest';
import { resolveRoomCommunity } from '../websocket.js';

const DEMO = '00000000-0000-0000-0000-000000000043';
const OTHER = '00000000-0000-0000-0000-000000000001';

describe('resolveRoomCommunity', () => {
  it('lets a super_admin follow the community it selected', () => {
    const user = { role: 'super_admin', community_id: null };
    expect(resolveRoomCommunity(user, DEMO)).toBe(DEMO);
  });

  it('returns null for a super_admin that selected nothing, so the socket is refused', () => {
    // This was the live bug: the room became `community:undefined` and every
    // broadcast was silently dropped.
    const user = { role: 'super_admin', community_id: null };
    expect(resolveRoomCommunity(user, undefined)).toBeNull();
  });

  it('never lets a community_admin follow someone else\'s community', () => {
    const user = { role: 'community_admin', community_id: OTHER };
    expect(resolveRoomCommunity(user, DEMO)).toBe(OTHER);
  });

  it('pins a community_admin to its own community when it asks for nothing', () => {
    const user = { role: 'community_admin', community_id: OTHER };
    expect(resolveRoomCommunity(user, undefined)).toBe(OTHER);
  });

  it('ignores a non-uuid request rather than interpolating it into a room name', () => {
    const user = { role: 'super_admin', community_id: null };
    for (const bad of ['*', '', 'null', 'undefined', '../admin', "'; DROP", 'community:x']) {
      expect(resolveRoomCommunity(user, bad)).toBeNull();
    }
  });

  it('does not treat a guard or resident token as privileged', () => {
    for (const role of ['guard', 'resident']) {
      const user = { role, community_id: OTHER };
      expect(resolveRoomCommunity(user, DEMO)).toBe(OTHER);
    }
  });

  it('returns null rather than throwing on a malformed user', () => {
    expect(resolveRoomCommunity(undefined, DEMO)).toBeNull();
    expect(resolveRoomCommunity({}, DEMO)).toBeNull();
  });
});
