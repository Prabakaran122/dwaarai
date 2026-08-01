import { describe, it, expect } from 'vitest';
import { newDelivery, newPass } from '../trickle.js';
import { mulberry32 } from '../rhythm.js';
import { DEMO_COMMUNITY_ID } from '../config.js';

// Shaped exactly like loadPopulation()'s return value — the shape production
// actually uses — rather than buildPopulation()'s, whose units always carry a
// `status` and therefore can't reproduce the bug where a query forgets to
// select it. (Minor 5: that divergence is what hid Critical 1.)
function fixturePopulation() {
  const units = [
    { id: 'unit-occupied-1', unitNumber: 'A-101', status: 'occupied' },
    { id: 'unit-occupied-2', unitNumber: 'A-102', status: 'occupied' },
    { id: 'unit-rented-1', unitNumber: 'B-201', status: 'rented' },
    { id: 'unit-vacant-1', unitNumber: 'C-301', status: 'vacant' },
  ];
  const residents = [
    { id: 'res-1', unitId: 'unit-occupied-1', name: 'Rajesh Sharma', type: 'owner', isPrimary: true },
    { id: 'res-2', unitId: 'unit-occupied-1', name: 'Sunita Sharma', type: 'family', isPrimary: false },
    { id: 'res-3', unitId: 'unit-occupied-2', name: 'Amit Yadav', type: 'owner', isPrimary: true },
    { id: 'res-4', unitId: 'unit-rented-1', name: 'Priya Gupta', type: 'tenant', isPrimary: true },
  ];
  const guards = [
    { id: 'guard-1', unitId: null, name: 'Ram Kishan', type: 'guard', isPrimary: false },
  ];
  const vehicles = [
    { id: 'veh-1', unitId: 'unit-occupied-1', residentId: 'res-1', plate: 'HR26AB1234' },
  ];
  return { units, residents, vehicles, guards };
}

const pop = fixturePopulation();
const now = new Date('2026-07-31T12:00:00Z');

describe('newDelivery', () => {
  it('is scoped to the demo community and a real unit', () => {
    const d = newDelivery(pop, mulberry32(1), now);
    expect(d.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(pop.units.some((u) => u.id === d.unit_id)).toBe(true);
    expect(d.company).toBeTruthy();
  });

  it('uses the real "waiting" status vocabulary, not an invented one', () => {
    // Critical 2: every consumer (deliveries.js, dashboard.js, handover.js,
    // resident-home.js) filters status = 'waiting'. 'pending' would insert
    // cleanly and then be invisible everywhere.
    const d = newDelivery(pop, mulberry32(1), now);
    expect(d.status).toBe('waiting');
  });

  it('never picks the vacant unit', () => {
    for (let seed = 0; seed < 50; seed++) {
      const d = newDelivery(pop, mulberry32(seed), now);
      expect(d.unit_id).not.toBe('unit-vacant-1');
    }
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

  it('never crashes on a unit with undefined status (Critical 1)', () => {
    // A unit whose `status` field came back undefined from an incomplete
    // query must not slip past the vacancy filter and then blow up looking
    // for a primary resident that doesn't exist.
    const brokenPop = {
      ...pop,
      units: [...pop.units, { id: 'unit-broken', unitNumber: 'Z-999', status: undefined }],
    };
    for (let seed = 0; seed < 50; seed++) {
      expect(() => newPass(brokenPop, mulberry32(seed), now)).not.toThrow();
    }
  });

  it('returns null rather than throwing if no unit has a resident to host the pass', () => {
    const noResidents = { ...pop, residents: [], units: pop.units };
    expect(() => newPass(noResidents, mulberry32(4), now)).not.toThrow();
    expect(newPass(noResidents, mulberry32(4), now)).toBeNull();
  });
});
