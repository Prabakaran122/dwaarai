import { spacing, radius } from './spacing';

describe('spacing tokens', () => {
  it('follows the 8dp grid per Brief §6', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(spacing.xl).toBe(24);
    expect(spacing['2xl']).toBe(32);
  });
  it('keeps extended keys used by existing screens', () => {
    expect(spacing['3xl']).toBeGreaterThan(0);
    expect(spacing['5xl']).toBeGreaterThan(0);
  });
  it('radius matches Brief §6 with legacy pill alias', () => {
    expect(radius.sm).toBe(8);
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(16);
    expect(radius.full).toBe(9999);
    expect(radius.pill).toBe(20);
  });
});
