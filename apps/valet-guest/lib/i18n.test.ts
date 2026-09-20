import { describe, it, expect } from 'vitest';
import { S } from './i18n';

describe('guest page copy', () => {
  it('has all three languages for every string', () => {
    for (const [key, entry] of Object.entries(S)) {
      // A half-translated page is worse than an English one: the guest reads
      // their language, hits an English sentence, and stops trusting the rest.
      expect(entry.en, `${key} en`).toBeTruthy();
      expect(entry.hi, `${key} hi`).toBeTruthy();
      expect(entry.kn, `${key} kn`).toBeTruthy();
    }
  });

  it('does not leave a translation identical to the English', () => {
    const untranslated = Object.entries(S).filter(
      ([, e]) => e.hi === e.en || e.kn === e.en
    );

    expect(untranslated.map(([k]) => k)).toEqual([]);
  });
});
