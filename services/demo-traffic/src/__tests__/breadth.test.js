import { describe, it, expect } from 'vitest';
import { buildBreadth, INCIDENT_TYPES } from '../breadth.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';

const pop = buildPopulation(2043);
const b = buildBreadth(pop, mulberry32(99), new Date('2026-07-31T12:00:00Z'));

describe('buildBreadth', () => {
  it('fills every portal section so no page is a dead end', () => {
    for (const key of ['passes', 'deliveries', 'incidents', 'notices', 'dues',
                       'facilities', 'bookings', 'polls', 'pollOptions', 'pollVotes',
                       'sosAlerts', 'pets', 'rfidCards', 'handovers']) {
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

  it('uses only the incident types the portal knows how to label', () => {
    // apps/admin-portal/app/incidents/page.tsx maps exactly these six; anything
    // else inserts fine and then renders as raw snake_case on the page.
    for (const inc of b.incidents) expect(INCIDENT_TYPES).toContain(inc.type);
    // and the seeds should actually exercise the vocabulary, not sit on one value
    expect(new Set(b.incidents.map((i) => i.type)).size).toBeGreaterThanOrEqual(4);
    for (const inc of b.incidents) expect(inc.description.length).toBeGreaterThan(20);
  });

  it('gives every poll a real ballot with votes already cast', () => {
    // A poll with no options renders as an unvotable card reading "0 votes" —
    // three of them was the Community page's entire content.
    const optionsByPoll = new Map();
    for (const o of b.pollOptions) {
      expect(o.label.length).toBeGreaterThan(0);
      if (!optionsByPoll.has(o.poll_id)) optionsByPoll.set(o.poll_id, []);
      optionsByPoll.get(o.poll_id).push(o);
    }
    const votesByPoll = new Map();
    for (const v of b.pollVotes) {
      votesByPoll.set(v.poll_id, (votesByPoll.get(v.poll_id) || 0) + 1);
    }

    for (const poll of b.polls) {
      const opts = optionsByPoll.get(poll.id) || [];
      expect(opts.length, `poll "${poll.question}" has no ballot`).toBeGreaterThanOrEqual(2);
      // routes/polls.js caps a created poll at 6 options; stay inside it.
      expect(opts.length).toBeLessThanOrEqual(6);
      // positions are 0..n-1, which is what the options query orders by
      expect(opts.map((o) => o.position).sort((x, y) => x - y)).toEqual(opts.map((_, i) => i));
      expect(votesByPoll.get(poll.id) || 0, `poll "${poll.question}" has no votes`).toBeGreaterThan(0);
    }
  });

  it('casts every vote for a real option of its own poll, one per unit', () => {
    const optionIds = new Map(b.pollOptions.map((o) => [o.id, o.poll_id]));
    const residentIds = new Set(pop.residents.map((r) => r.id));
    const unitIds = new Set(pop.units.map((u) => u.id));
    const seenUnit = new Set();
    const seenResident = new Set();

    for (const v of b.pollVotes) {
      expect(optionIds.get(v.option_id)).toBe(v.poll_id);
      expect(residentIds.has(v.resident_id)).toBe(true);
      expect(unitIds.has(v.unit_id)).toBe(true);
      // uniq_poll_unit (migration 029) and the dropped (poll_id, resident_id)
      // primary key from 027 — respect both.
      const unitKey = `${v.poll_id}|${v.unit_id}`;
      const residentKey = `${v.poll_id}|${v.resident_id}`;
      expect(seenUnit.has(unitKey)).toBe(false);
      expect(seenResident.has(residentKey)).toBe(false);
      seenUnit.add(unitKey);
      seenResident.add(residentKey);
    }
  });

  it('spreads votes across options so no result is unanimous', () => {
    for (const poll of b.polls) {
      const opts = b.pollOptions.filter((o) => o.poll_id === poll.id);
      const used = new Set(
        b.pollVotes.filter((v) => v.poll_id === poll.id).map((v) => v.option_id)
      );
      expect(used.size).toBeGreaterThan(1);
      expect(used.size).toBeLessThanOrEqual(opts.length);
    }
  });

  it('derives the dues period from `now` instead of hardcoding a month', () => {
    const july = buildBreadth(pop, mulberry32(99), new Date('2026-07-31T12:00:00Z'));
    const december = buildBreadth(pop, mulberry32(99), new Date('2026-12-04T12:00:00Z'));
    expect(july.dues[0].period).toBe('2026-07');
    expect(july.dues[0].due_date).toBe('2026-07-10');
    expect(december.dues[0].period).toBe('2026-12');
    expect(december.dues[0].due_date).toBe('2026-12-10');
    expect(december.dues[0].description).toContain('December 2026');
  });

  it('never dates a shift handover in the future', () => {
    // 08:00 IST: today's 14:00 and 22:00 shifts have not happened yet.
    const now = new Date('2026-07-31T02:30:00Z');
    const early = buildBreadth(pop, mulberry32(99), now);
    expect(early.handovers.length).toBeGreaterThan(0);
    for (const h of early.handovers) {
      expect(new Date(h.created_at).getTime()).toBeLessThanOrEqual(now.getTime());
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
