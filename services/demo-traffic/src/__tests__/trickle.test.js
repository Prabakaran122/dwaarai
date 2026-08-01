import { describe, it, expect } from 'vitest';
import { newDelivery, newPass } from '../trickle.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';
import { DEMO_COMMUNITY_ID } from '../config.js';

const pop = buildPopulation(2043);
const now = new Date('2026-07-31T12:00:00Z');

describe('newDelivery', () => {
  it('is scoped to the demo community and a real unit', () => {
    const d = newDelivery(pop, mulberry32(1), now);
    expect(d.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(pop.units.some((u) => u.id === d.unit_id)).toBe(true);
    expect(d.company).toBeTruthy();
    expect(d.status).toBe('pending');
  });
});

describe('newPass', () => {
  it('creates a currently-valid visitor pass', () => {
    const p = newPass(pop, mulberry32(2), now);
    expect(p.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(new Date(p.valid_from) <= now).toBe(true);
    expect(new Date(p.valid_until) > now).toBe(true);
    expect(p.status).toBe('active');
    expect(p.otp).toMatch(/^\d{6}$/);
  });

  it('attributes the pass to a resident of the unit it targets', () => {
    const p = newPass(pop, mulberry32(3), now);
    const creator = pop.residents.find((r) => r.id === p.created_by);
    expect(creator).toBeTruthy();
    expect(creator.unitId).toBe(p.unit_id);
  });
});
