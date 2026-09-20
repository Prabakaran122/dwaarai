import { parseCardCode } from './cardCode';

describe('parseCardCode', () => {
  const V = '978aa095-6aa9-45b6-b6d5-d3a915dfca38';

  it('reads the code out of a card QR', () => {
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/A047`)).toBe('A047');
  });

  it('handles a trailing slash and a query string', () => {
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/A047?utm=x`)).toBe('A047');
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/A047#top`)).toBe('A047');
  });

  it('refuses a card QR with no venue in it', () => {
    // Card codes are unique per venue, not globally. A bare code would bind
    // against whichever property the database happened to return first.
    expect(parseCardCode('https://dwaarai.com/valet/c/A047')).toBeNull();
  });

  it('accepts a bare code, for when the camera will not focus', () => {
    expect(parseCardCode('a047')).toBe('A047');
    expect(parseCardCode('  A-047 ')).toBe('A-047');
  });

  it('uppercases, since codes are matched case-insensitively server-side', () => {
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/a047`)).toBe('A047');
  });

  it('refuses another QR that merely happens to be a URL', () => {
    // Taking the last path segment of anything would let a valet bind a
    // parking sticker or a menu as a card, and it would only surface later as
    // a card resolving to nothing.
    expect(parseCardCode('https://example.com/menu/A047')).toBeNull();
    expect(parseCardCode('https://dwaarai.com/valet/v/sometoken')).toBeNull();
  });

  it('refuses non-URL schemes', () => {
    expect(parseCardCode('WIFI:S:Guest;T:WPA;P:hunter2;;')).toBeNull();
    expect(parseCardCode('mailto:someone@example.com')).toBeNull();
  });

  it('refuses a code too long for the column', () => {
    expect(parseCardCode('X'.repeat(21))).toBeNull();
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/${'X'.repeat(21)}`)).toBeNull();
  });

  it('refuses empty and junk input', () => {
    expect(parseCardCode('')).toBeNull();
    expect(parseCardCode('   ')).toBeNull();
    expect(parseCardCode('A047 0435')).toBeNull();
  });

  it('decodes a percent-encoded segment', () => {
    expect(parseCardCode(`https://dwaarai.com/valet/c/${V}/A%2D047`)).toBe('A-047');
  });
});
