import { colors } from './colors';

describe('Nazar colour tokens (BRD §3)', () => {
  it('defines the exact brand/action palette', () => {
    expect(colors.bgPrimary).toBe('#0D2535');
    expect(colors.surface).toBe('#1B3A4B');
    expect(colors.card).toBe('#1E3A4F');
    expect(colors.elevated).toBe('#243F55');
    expect(colors.actionPrimary).toBe('#F59E0B');
  });

  it('defines the verification-layer accent colours', () => {
    expect(colors.teal).toBe('#00BFA6');
    expect(colors.amber).toBe('#F59E0B');
    expect(colors.purple).toBe('#A78BFA');
    expect(colors.green).toBe('#34D399');
  });

  it('defines danger, border, and text tokens', () => {
    expect(colors.danger).toBe('#F87171');
    expect(colors.border).toBe('#2A4A5E');
    expect(colors.textPrimary).toBe('#F0F4F8');
    expect(colors.textSecondary).toBe('#8BAABB');
    expect(colors.textTertiary).toBe('#5A7A8A');
  });

  it('keeps every legacy key existing screens reference', () => {
    for (const key of [
      'bgPrimary', 'surface', 'surfaceBorder', 'textMuted', 'textPrimary', 'textSecondary',
      'white', 'success', 'successBg', 'danger', 'dangerBg', 'warning', 'warningBg', 'info', 'infoBg',
    ] as const) {
      expect(colors[key]).toBeDefined();
    }
    for (const g of ['gradientBg', 'gradientPrimary', 'gradientSuccess', 'gradientDanger'] as const) {
      expect(Array.isArray(colors[g])).toBe(true);
      expect(colors[g]).toHaveLength(2);
    }
  });
});
