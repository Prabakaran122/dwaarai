import { describe, it, expect } from 'vitest';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from '../config.js';

describe('config', () => {
  it('pins the demo community UUID', () => {
    expect(DEMO_COMMUNITY_ID).toBe('00000000-0000-0000-0000-000000000043');
  });

  it('defines three gates whose shares sum to 1', () => {
    expect(GATES).toHaveLength(3);
    const total = GATES.reduce((sum, g) => sum + g.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('refuses any community other than the demo one', () => {
    expect(() => assertDemoCommunity(DEMO_COMMUNITY_ID)).not.toThrow();
    expect(() => assertDemoCommunity('00000000-0000-0000-0000-000000000001'))
      .toThrow(/refusing/i);
  });

  it('reads settings from the environment', () => {
    const c = config({
      API_BASE: 'http://127.0.0.1:3000/api/v1',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      JWT_SECRET: 's3cret',
      DRY_RUN: 'true',
    });
    expect(c.apiBase).toBe('http://127.0.0.1:3000/api/v1');
    expect(c.jwtSecret).toBe('s3cret');
    expect(c.dryRun).toBe(true);
  });

  it('defaults the community to the demo tenant', () => {
    expect(config({ JWT_SECRET: 's' }).communityId).toBe(DEMO_COMMUNITY_ID);
  });

  it('rejects a COMMUNITY_ID override that is not the demo tenant', () => {
    // The guarantee the entrypoints rely on: config() resolves the override and
    // both seed.js and generate.js assert the *resolved* value, so a
    // misconfigured unit throws at startup instead of writing into a real
    // society. Passing the module constant to itself could never throw.
    const resolved = config({
      JWT_SECRET: 's',
      COMMUNITY_ID: '11111111-1111-1111-1111-111111111111',
    }).communityId;
    expect(resolved).toBe('11111111-1111-1111-1111-111111111111');
    expect(() => assertDemoCommunity(resolved)).toThrow(/refusing/i);
  });

  it('accepts a COMMUNITY_ID override that spells out the demo tenant', () => {
    const resolved = config({ JWT_SECRET: 's', COMMUNITY_ID: DEMO_COMMUNITY_ID }).communityId;
    expect(() => assertDemoCommunity(resolved)).not.toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    expect(() => config({ DATABASE_URL: 'x' })).toThrow(/JWT_SECRET/);
  });
});
