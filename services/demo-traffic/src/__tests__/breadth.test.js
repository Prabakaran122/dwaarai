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

  // The three below pin the seeded vocabulary to what the API actually reads.
  // Nothing in the schema enforces these — there are no CHECK constraints — so a
  // drift here inserts cleanly and only shows up as an empty page in the demo.

  it("uses the delivery vocabulary routes/deliveries.js reads, and leaves parcels 'waiting'", () => {
    for (const d of b.deliveries) {
      expect(['waiting', 'delivered', 'left_at_gate']).toContain(d.status);
    }
    // routes/deliveries.js:125 lists only status='waiting' on the guard screen.
    const waiting = b.deliveries.filter((d) => d.status === 'waiting');
    expect(waiting.length).toBe(15);
    expect(b.deliveries.filter((d) => d.status === 'delivered').length).toBe(45);
  });

  it("books facility slots as 'booked' and never double-books one", () => {
    // routes/facilities.js filters status='booked'; uniq_facility_slot is a
    // UNIQUE index on (facility_id, booking_date, start_time) partial on it.
    for (const bk of b.bookings) expect(bk.status).toBe('booked');
    const slots = b.bookings.map((bk) => `${bk.facility_id}|${bk.booking_date}|${bk.start_time}`);
    expect(new Set(slots).size).toBe(b.bookings.length);
  });

  it('categorises notices as the notice board does, with the pinned one official', () => {
    // routes/notices.js:13 — zod enum of exactly these two.
    for (const n of b.notices) expect(['official', 'discussion']).toContain(n.category);
    const categories = new Set(b.notices.map((n) => n.category));
    expect(categories.has('official')).toBe(true);
    expect(categories.has('discussion')).toBe(true);

    const pinned = b.notices.filter((n) => n.is_pinned);
    expect(pinned.length).toBe(1);
    expect(pinned[0].category).toBe('official');

    // An 'official' post is the RWA speaking; a 'discussion' is a resident.
    for (const n of b.notices) {
      expect(n.posted_by_role).toBe(n.category === 'official' ? 'admin' : 'resident');
    }
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
