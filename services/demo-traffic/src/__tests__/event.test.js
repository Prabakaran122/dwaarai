import { describe, it, expect } from 'vitest';
import { buildEvent } from '../event.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';
import { GATES, DEMO_COMMUNITY_ID } from '../config.js';
import { eventSyncItemSchema } from '../../../api-gateway/src/schemas/event-sync.js';

const pop = buildPopulation(2043);

describe('buildEvent', () => {
  it('produces payloads that satisfy the real ingestion contract', () => {
    const rand = mulberry32(21);
    for (let i = 0; i < 300; i++) {
      const evt = buildEvent({ pop, gate: GATES[i % 3], at: new Date(), rand });
      const parsed = eventSyncItemSchema.safeParse(evt);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
      expect(parsed.success).toBe(true);
    }
  });

  it('always targets the demo community and the given gate', () => {
    const rand = mulberry32(22);
    const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
    expect(evt.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(evt.gate_id).toBe(GATES[0].id);
  });

  it('marks events as live, not offline syncs', () => {
    const rand = mulberry32(23);
    const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
    expect(evt.is_offline_event).toBe(false);
  });

  it('is overwhelmingly allow, with a small deny and review tail', () => {
    const rand = mulberry32(24);
    const counts = {};
    for (let i = 0; i < 5000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      counts[evt.access_decision] = (counts[evt.access_decision] || 0) + 1;
    }
    expect(counts.allow / 5000).toBeGreaterThan(0.85);
    expect(counts.allow / 5000).toBeLessThan(0.97);
    expect(counts.deny).toBeGreaterThan(0);
    expect(counts.guard_review).toBeGreaterThan(0);
  });

  it('always gives a denied event a reason', () => {
    const rand = mulberry32(25);
    for (let i = 0; i < 2000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.access_decision === 'deny') expect(evt.deny_reason).toBeTruthy();
    }
  });

  it('attaches a confidence score to ANPR reads only', () => {
    const rand = mulberry32(26);
    for (let i = 0; i < 1000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.detection_method === 'anpr') {
        expect(evt.anpr_confidence).toBeGreaterThan(0);
        expect(evt.anpr_confidence).toBeLessThanOrEqual(1);
      } else {
        expect(evt.anpr_confidence).toBeNull();
      }
    }
  });

  it('balances entries against exits over a full day of traffic', () => {
    // The dashboard's occupancy tile is entries minus exits since midnight, so a
    // structural entry surplus makes "currently inside" climb all day. Sample the
    // gates in their real proportions rather than round-robin.
    const rand = mulberry32(28);
    const counts = { entry: 0, exit: 0 };
    const n = 30000;
    for (let i = 0; i < n; i++) {
      let roll = rand();
      let gate = GATES[GATES.length - 1];
      for (const g of GATES) {
        roll -= g.share;
        if (roll <= 0) { gate = g; break; }
      }
      counts[buildEvent({ pop, gate, at: new Date(), rand }).direction]++;
    }
    const entryShare = counts.entry / n;
    expect(entryShare).toBeGreaterThan(0.47);
    expect(entryShare).toBeLessThan(0.53);
  });

  it('keeps each gate plausible: the main gate lets people in, the exit gate out', () => {
    const share = (gate) => {
      const rand = mulberry32(29);
      let entries = 0;
      for (let i = 0; i < 5000; i++) {
        if (buildEvent({ pop, gate, at: new Date(), rand }).direction === 'entry') entries++;
      }
      return entries / 5000;
    };
    expect(share(GATES.find((g) => g.type === 'entry'))).toBeGreaterThan(0.6);
    expect(share(GATES.find((g) => g.type === 'exit'))).toBeLessThan(0.25);
  });

  it('resolves known vehicles to their unit and resident', () => {
    const rand = mulberry32(27);
    let matched = 0;
    for (let i = 0; i < 500; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.matched_vehicle_id) {
        expect(evt.matched_unit_number).toBeTruthy();
        expect(evt.resident_name).toBeTruthy();
        matched++;
      }
    }
    expect(matched).toBeGreaterThan(300);
  });
});
