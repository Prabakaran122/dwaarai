import { isOverstayed } from './delivery';

describe('isOverstayed (NAZ-045 — 15-minute overstay flag)', () => {
  it('is false just under the 15-minute threshold', () => {
    const createdAt = new Date(Date.now() - 14 * 60_000).toISOString();
    expect(isOverstayed(createdAt)).toBe(false);
  });

  it('is true at and beyond the 15-minute threshold', () => {
    const createdAt = new Date(Date.now() - 15 * 60_000 - 1000).toISOString();
    expect(isOverstayed(createdAt)).toBe(true);
  });

  it('is false for a delivery that just arrived', () => {
    expect(isOverstayed(new Date().toISOString())).toBe(false);
  });
});
