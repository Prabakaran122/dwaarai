import { describe, it, expect, vi } from 'vitest';
import { isValidIndianMobile, formatCountdown, resolveValetBase, valetDeviceId } from './api';

describe('isValidIndianMobile', () => {
  it.each(['9876543210', '6123456789', '+919876543210', '98765 43210', '+91 98765 43210'])(
    'accepts %s',
    (input) => expect(isValidIndianMobile(input)).toBe(true)
  );

  it.each([
    ['too short', '98765'],
    ['too long', '98765432101'],
    ['starts below 6', '5876543210'],
    ['letters', 'abcdefghij'],
    ['empty', ''],
    ['wrong country code', '+449876543210'],
  ])('rejects %s', (_label, input) => {
    expect(isValidIndianMobile(input)).toBe(false);
  });

  it('mirrors the server rule, so the guest is never told yes then no', () => {
    // The service validates with /^(\+91)?[6-9]\d{9}$/ after stripping spaces.
    const serverRule = (raw: string) => /^(\+91)?[6-9]\d{9}$/.test(raw.replace(/\s+/g, ''));
    for (const sample of ['9876543210', '+91 98765 43210', '1234567890', '', 'abc']) {
      expect(isValidIndianMobile(sample)).toBe(serverRule(sample));
    }
  });
});

describe('formatCountdown', () => {
  it('renders minutes and zero-padded seconds', () => {
    expect(formatCountdown(285)).toBe('4:45');
    expect(formatCountdown(65)).toBe('1:05');
  });

  it('renders zero as 0:00 rather than anything negative-looking', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('handles a sub-minute remainder', () => {
    expect(formatCountdown(9)).toBe('0:09');
  });
});

describe('resolveValetBase', () => {
  it('uses the configured URL', () => {
    expect(resolveValetBase('https://dwaarai.com/valet-api', 'production')).toBe('https://dwaarai.com/valet-api');
  });

  it('falls back to localhost only outside production', () => {
    expect(resolveValetBase(undefined, 'development')).toBe('http://localhost:3060');
    expect(resolveValetBase(undefined, 'test')).toBe('http://localhost:3060');
  });

  // A production build that silently called localhost failed on every guest's
  // phone with nothing in any server log.
  it('throws in production with the variable unset', () => {
    expect(() => resolveValetBase(undefined, 'production')).toThrow(/NEXT_PUBLIC_VALET_API_URL/);
    expect(() => resolveValetBase('', 'production')).toThrow();
  });
});

describe('valetDeviceId', () => {
  it('is made once and then reused', () => {
    localStorage.clear();
    const first = valetDeviceId();
    expect(first).toMatch(/^[A-Za-z0-9-]{16,128}$/);
    expect(valetDeviceId()).toBe(first);
  });

  it('replaces a stored value that is not a device id', () => {
    localStorage.setItem('dwaarai.valet.deviceId', 'junk');
    expect(valetDeviceId()).toMatch(/^[A-Za-z0-9-]{16,128}$/);
  });

  it('survives storage that throws, keeping one id for the tab', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const a = valetDeviceId();
    expect(valetDeviceId()).toBe(a);
    spy.mockRestore();
  });
});
