import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneKey } from '../lib/phone.js';

describe('normalizePhone', () => {
  it('attaches the country code to what a guard typed', () => {
    expect(normalizePhone('9003143250')).toBe('919003143250');
  });

  it('leaves a number that already carries one alone', () => {
    expect(normalizePhone('919003143250')).toBe('919003143250');
  });

  it('strips the punctuation people actually type', () => {
    expect(normalizePhone('+91 90031 43250')).toBe('919003143250');
  });

  it('refuses something too short to be a number', () => {
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('phoneKey', () => {
  it('matches the same number written two ways', () => {
    // The guard typed ten digits; WhatsApp delivered twelve. Before this they
    // were different strings and the guest could not be found.
    expect(phoneKey('9003143250')).toBe(phoneKey('919003143250'));
    expect(phoneKey('+91 90031 43250')).toBe(phoneKey('919003143250'));
  });

  it('does not collide two different numbers', () => {
    expect(phoneKey('9003143250')).not.toBe(phoneKey('9003143251'));
  });
});
