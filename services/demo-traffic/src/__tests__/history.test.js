import { describe, it, expect } from 'vitest';
import { buildHistory } from '../history.js';
import { buildPopulation } from '../population.js';
import { mulberry32, istClock } from '../rhythm.js';

const pop = buildPopulation(2043);
const until = new Date('2026-07-31T12:00:00Z');
const events = buildHistory({ pop, days: 10, until, rand: mulberry32(5) });

describe('buildHistory', () => {
  it('produces roughly ten days of traffic', () => {
    expect(events.length).toBeGreaterThan(9000);
    expect(events.length).toBeLessThan(14000);
  });

  it('never emits an event in the future', () => {
    for (const e of events) expect(new Date(e.event_ts) <= until).toBe(true);
  });

  it('covers all ten days', () => {
    const days = new Set(events.map((e) => e.event_ts.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(10);
  });

  it('is busier at 9am than at 3am — in Asia/Kolkata, the zone the charts use', () => {
    const at = (h) => events.filter((e) => istClock(new Date(e.event_ts)).hour === h).length;
    expect(at(9)).toBeGreaterThan(at(3));
  });

  it('puts the morning peak on the morning of the IST clock, not the UTC one', () => {
    // The regression this guards: deriving the hour in UTC on a UTC server
    // renders the 08:00–10:00 rush at 13:30–15:30 IST and the dead zone at
    // breakfast time. Nothing errors — the shape is simply 5½ hours wrong.
    const istHours = events.map((e) => istClock(new Date(e.event_ts)).hour);
    const count = (h) => istHours.filter((x) => x === h).length;
    const morning = count(8) + count(9);
    const afternoon = count(14) + count(15);
    const deadZone = count(2) + count(3) + count(4);
    expect(morning).toBeGreaterThan(afternoon * 2);
    expect(deadZone).toBeLessThan(morning / 10);
  });

  it('spreads traffic across all three gates', () => {
    const gates = new Set(events.map((e) => e.gate_id));
    expect(gates.size).toBe(3);
  });

  it('returns events in ascending time order', () => {
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].event_ts) >= new Date(events[i - 1].event_ts)).toBe(true);
    }
  });
});
