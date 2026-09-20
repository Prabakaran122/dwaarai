import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../lib/plate.js';
import { nextDisplayId, newSessionToken, newRotatingToken, newDiscountCode } from '../lib/tokens.js';
import { extensionFor, buildKey } from '../lib/storage.js';

describe('normalizePlate', () => {
  it('strips whitespace and uppercases', () => {
    expect(normalizePlate('ka 03 nj 0435')).toBe('KA03NJ0435');
  });

  it('maps the spaced and unspaced forms of one plate to the same key', () => {
    // This is the whole point of the function: write time and lookup time must
    // never disagree about whether two plates are the same vehicle.
    expect(normalizePlate('KA 03 NJ 0435')).toBe(normalizePlate('KA03NJ0435'));
  });

  it('handles null and undefined without throwing', () => {
    expect(normalizePlate(null)).toBe('');
    expect(normalizePlate(undefined)).toBe('');
  });

  it('collapses interior tabs and multiple spaces', () => {
    expect(normalizePlate('KA\t03  NJ 0435')).toBe('KA03NJ0435');
  });
});

describe('nextDisplayId', () => {
  it('starts at DWR-0001 when a community has no tickets yet', () => {
    expect(nextDisplayId(undefined)).toBe('DWR-0001');
    expect(nextDisplayId(null)).toBe('DWR-0001');
  });

  it('increments and keeps the four-digit padding', () => {
    expect(nextDisplayId('DWR-0001')).toBe('DWR-0002');
    expect(nextDisplayId('DWR-0099')).toBe('DWR-0100');
  });

  it('grows past four digits rather than wrapping', () => {
    expect(nextDisplayId('DWR-9999')).toBe('DWR-10000');
  });

  it('falls back to 1 on an unparseable previous id instead of producing NaN', () => {
    expect(nextDisplayId('GARBAGE')).toBe('DWR-0001');
  });
});

describe('token generation', () => {
  it('issues session tokens long enough to be unguessable', () => {
    expect(newSessionToken()).toHaveLength(32);
  });

  it('issues distinct tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
    expect(tokens.size).toBe(200);
  });

  it('issues rotating tokens of the expected length', () => {
    expect(newRotatingToken()).toHaveLength(24);
  });

  it('issues discount codes with no visually ambiguous characters', () => {
    // Codes get read aloud and typed at a counter, so 0/O and 1/I are excluded.
    for (let i = 0; i < 100; i += 1) {
      const code = newDiscountCode();
      expect(code).toMatch(/^DWAAR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});

describe('storage keys', () => {
  it('maps mimetypes to the right extension', () => {
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('video/webm')).toBe('webm');
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('application/octet-stream')).toBe('bin');
  });

  it('namespaces keys by kind and ticket so a ticket\'s media groups together', () => {
    const key = buildKey('photo', 'ticket-abc', 'jpg');
    expect(key).toMatch(/^valet\/photo\/ticket-abc\/\d+-[0-9a-f]{8}\.jpg$/);
  });

  it('does not collide for two captures in the same millisecond', () => {
    const keys = new Set(Array.from({ length: 100 }, () => buildKey('photo', 't', 'jpg')));
    expect(keys.size).toBe(100);
  });
});
