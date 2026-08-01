import { describe, it, expect } from 'vitest';
import { buildHistory } from '../history.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';

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

  it('is busier at 9am than at 3am', () => {
    const at = (h) => events.filter((e) => new Date(e.event_ts).getUTCHours() === h).length;
    expect(at(9)).toBeGreaterThan(at(3));
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
