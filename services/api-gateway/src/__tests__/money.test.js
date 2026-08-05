import { describe, it, expect } from 'vitest';
import { PLATFORM_FEE_RATE, platformFeePaise, stallTotalPaise, rupees } from '../lib/money.js';

describe('platform fee', () => {
  it('is 3% of the stall fee', () => {
    expect(PLATFORM_FEE_RATE).toBe(0.03);
    expect(platformFeePaise(100000)).toBe(3000);       // ₹1000 -> ₹30
  });

  it('rounds to the nearest RUPEE, per the BRD acceptance criteria', () => {
    // ₹1500 * 3% = ₹45.00 exactly
    expect(platformFeePaise(150000)).toBe(4500);
    // ₹1250 * 3% = ₹37.50 -> ₹38
    expect(platformFeePaise(125000)).toBe(3800);
    // ₹1010 * 3% = ₹30.30 -> ₹30
    expect(platformFeePaise(101000)).toBe(3000);
  });

  it('never returns a fraction of a paise, and never a float', () => {
    for (const fee of [1, 99, 100, 12345, 999999]) {
      const f = platformFeePaise(fee);
      expect(Number.isInteger(f)).toBe(true);
      expect(f % 100).toBe(0); // whole rupees
    }
  });

  it('charges nothing on a zero-fee stall', () => {
    expect(platformFeePaise(0)).toBe(0);
  });

  it('totals the stall fee plus the platform fee', () => {
    expect(stallTotalPaise(125000)).toBe(125000 + 3800);
  });

  it('formats paise as rupees for display', () => {
    expect(rupees(125000)).toBe('1250.00');
    expect(rupees(0)).toBe('0.00');
  });
});
