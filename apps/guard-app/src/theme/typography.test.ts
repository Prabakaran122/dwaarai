import { font, type } from './typography';

describe('typography', () => {
  it('maps weights to DM Sans families', () => {
    expect(font(400).fontFamily).toBe('DMSans_400Regular');
    expect(font(500).fontFamily).toBe('DMSans_500Medium');
    expect(font(700).fontFamily).toBe('DMSans_700Bold');
  });

  it('exposes the type scale', () => {
    expect(type.h1.fontSize).toBe(20);
    expect(type.h2.fontSize).toBe(18);
    expect(type.h3.fontSize).toBe(15);
    expect(type.body.fontSize).toBe(14);
    expect(type.bodySecondary.fontSize).toBe(13);
    expect(type.caption.fontSize).toBe(11);
    expect(type.micro.fontSize).toBe(10);
    expect(type.h1.fontFamily).toBe('DMSans_700Bold');
    expect(type.body.fontFamily).toBe('DMSans_400Regular');
  });
});
