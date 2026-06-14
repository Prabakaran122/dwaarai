import { font, type } from './typography';

describe('typography', () => {
  it('maps weights to DM Sans families', () => {
    expect(font(400).fontFamily).toBe('DMSans_400Regular');
    expect(font(500).fontFamily).toBe('DMSans_500Medium');
    expect(font(700).fontFamily).toBe('DMSans_700Bold');
  });
  it('exposes the Brief §5 scale', () => {
    expect(type.h1.fontSize).toBe(22);
    expect(type.h2.fontSize).toBe(18);
    expect(type.body.fontSize).toBe(14);
    expect(type.caption.fontSize).toBe(11);
    expect(type.h1.fontFamily).toBe('DMSans_500Medium');
  });
});
