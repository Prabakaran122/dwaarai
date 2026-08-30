import { describe, it, expect } from 'vitest';
import { isValidIndianMobile, formatCountdown } from './api';

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
