import { describe, it, expect } from 'vitest';
import { ratePerHour, nextGapMs, mulberry32 } from '../rhythm.js';

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
