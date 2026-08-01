import { describe, it, expect } from 'vitest';
import { ratePerHour, nextGapMs, mulberry32, istClock, IST_OFFSET_MS } from '../rhythm.js';

describe('ratePerHour', () => {
  it('is near-dead overnight and peaks in the morning rush', () => {
    expect(ratePerHour(3, false)).toBeLessThan(10);
    expect(ratePerHour(9, false)).toBeGreaterThan(100);
    expect(ratePerHour(3, false)).toBeLessThan(ratePerHour(9, false));
  });

  it('has a second peak in the evening', () => {
    expect(ratePerHour(19, false)).toBeGreaterThan(ratePerHour(15, false));
  });

  it('is positive for every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      expect(ratePerHour(h, false)).toBeGreaterThan(0);
      expect(ratePerHour(h, true)).toBeGreaterThan(0);
    }
  });

  it('flattens the commute peaks at weekends', () => {
    expect(ratePerHour(9, true)).toBeLessThan(ratePerHour(9, false));
  });

  it('sums to roughly 1150 events across a weekday', () => {
    let total = 0;
    for (let h = 0; h < 24; h++) total += ratePerHour(h, false);
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThan(1300);
  });
});

describe('istClock', () => {
  it('is a fixed +05:30 offset — India has no daylight saving', () => {
    expect(IST_OFFSET_MS).toBe(5.5 * 3600 * 1000);
  });

  it('maps a UTC instant to the hour it really is in Kolkata', () => {
    // 03:30 UTC is 09:00 IST — the middle of the morning peak. Reading the hour
    // off UTC would call this hour 3, the deadest hour on the curve.
    const { hour } = istClock(new Date('2026-07-31T03:30:00Z'));
    expect(hour).toBe(9);
    expect(ratePerHour(hour, false)).toBeGreaterThan(100);
  });

  it('rolls the day over for a late-evening UTC instant', () => {
    // Friday 19:00 UTC is Saturday 00:30 IST: a weekday in UTC, a weekend in IST.
    const friday = new Date('2026-07-31T19:00:00Z');
    expect(friday.getUTCDay()).toBe(5);          // Friday in UTC
    const { day, hour, isWeekend } = istClock(friday);
    expect(day).toBe(6);                          // Saturday in IST
    expect(hour).toBe(0);
    expect(isWeekend).toBe(true);
  });

  it('flips a Saturday-UTC instant onto Sunday in IST', () => {
    // 19:00 UTC on Saturday 1 Aug 2026 is 00:30 IST on Sunday.
    const saturday = new Date('2026-08-01T19:00:00Z');
    expect(saturday.getUTCDay()).toBe(6);
    expect(istClock(saturday).day).toBe(0);
  });

  it('leaves the weekday alone for a midday instant', () => {
    const { day, hour, isWeekend } = istClock(new Date('2026-07-29T06:00:00Z'));
    expect(day).toBe(3);        // Wednesday, both zones
    expect(hour).toBe(11);      // 11:30 IST
    expect(isWeekend).toBe(false);
  });
});

describe('nextGapMs', () => {
  it('averages close to 3600/rate seconds over many draws', () => {
    const rand = mulberry32(42);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += nextGapMs(60, rand);
    const meanSeconds = sum / n / 1000;
    expect(meanSeconds).toBeGreaterThan(50);
    expect(meanSeconds).toBeLessThan(70);
  });

  it('produces varied gaps, not a constant', () => {
    const rand = mulberry32(7);
    const gaps = new Set();
    for (let i = 0; i < 50; i++) gaps.add(nextGapMs(60, rand));
    expect(gaps.size).toBeGreaterThan(40);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
