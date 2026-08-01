import { describe, it, expect } from 'vitest';
import { buildBreadth } from '../breadth.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';

const pop = buildPopulation(2043);
const b = buildBreadth(pop, mulberry32(99), new Date('2026-07-31T12:00:00Z'));

describe('buildBreadth', () => {
  it('fills every portal section so no page is a dead end', () => {
    for (const key of ['passes', 'deliveries', 'incidents', 'notices', 'dues',
                       'facilities', 'bookings', 'polls', 'sosAlerts', 'pets',
                       'rfidCards', 'handovers']) {
      expect(b[key].length, `${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('uses courier brands a Faridabad society would actually see', () => {
    const companies = new Set(b.deliveries.map((d) => d.company));
    expect([...companies].some((c) => /Amazon|Flipkart|Blinkit|Zepto|Swiggy/.test(c)).valueOf()).toBe(true);
  });

  it('leaves some dues unpaid so the finance panel has something to show', () => {
    const statuses = new Set(b.dues.map((d) => d.status));
    expect(statuses.has('pending')).toBe(true);
  });

  it('resolves every SOS alert — an open one on a demo board looks alarming', () => {
    for (const a of b.sosAlerts) expect(a.status).toBe('resolved');
  });

  it('links every row to a real unit or gate from the population', () => {
    const unitIds = new Set(pop.units.map((u) => u.id));
    for (const d of b.dues) expect(unitIds.has(d.unit_id)).toBe(true);
    for (const p of b.pets) expect(unitIds.has(p.unit_id)).toBe(true);
  });

  it('gives staff cards a daily access window', () => {
    const staff = b.rfidCards.filter((c) => c.card_type === 'staff');
    expect(staff.length).toBeGreaterThan(0);
    for (const c of staff) {
      expect(c.access_start).toBeTruthy();
      expect(c.access_end).toBeTruthy();
    }
  });
});
