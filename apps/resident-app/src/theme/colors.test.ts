import { colors } from './colors';

describe('Dwaar colour tokens (Brief §3)', () => {
  it('defines brand colours', () => {
    expect(colors.brandPrimary).toBe('#1B3A4B');
    expect(colors.teal).toBe('#00BFA6');
    expect(colors.mist).toBe('#E8F4F8');
    expect(colors.actionPrimary).toBe('#F59E0B');
    expect(colors.actionHover).toBe('#D97706');
  });
  it('defines status signal + tint + on-tint text', () => {
    expect(colors.success).toBe('#2ECC71');
    expect(colors.tintSuccess).toBe('#EAFAF1');
    expect(colors.textSuccess).toBe('#1A7A44');
    expect(colors.error).toBe('#E84C3D');
    expect(colors.warning).toBe('#F6C90E');
    expect(colors.info).toBe('#3498DB');
  });
  it('defines text + surface tokens', () => {
    expect(colors.textPrimary).toBe('#1B3A4B');
    expect(colors.textSecondary).toBe('#557A8F');
    expect(colors.textTertiary).toBe('#8DAFC0');
    expect(colors.textInverse).toBe('#FFFFFF');
    expect(colors.surface).toBe('#FFFFFF');
  });
  it('keeps every legacy alias existing screens reference', () => {
    for (const key of [
      'bgPrimary', 'bgSecondary', 'danger', 'dangerBg', 'infoBg', 'successBg',
      'warningBg', 'warningBorder', 'textMuted', 'white', 'surfaceBorder',
    ] as const) {
      expect(colors[key]).toBeDefined();
    }
    for (const g of ['gradientBg', 'gradientPrimary', 'gradientAccent', 'gradientSuccess', 'gradientDanger'] as const) {
      expect(Array.isArray(colors[g])).toBe(true);
    }
  });
});
