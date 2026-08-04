import { describe, it, expect } from 'vitest';
import { nextStatusIsValid } from '../routes/issues.js';

describe('status transitions are forward-only', () => {
  it('allows each forward step', () => {
    expect(nextStatusIsValid('open', 'in_progress')).toBe(true);
    expect(nextStatusIsValid('in_progress', 'resolved')).toBe(true);
  });

  it('rejects every backwards step', () => {
    expect(nextStatusIsValid('in_progress', 'open')).toBe(false);
    expect(nextStatusIsValid('resolved', 'in_progress')).toBe(false);
    expect(nextStatusIsValid('resolved', 'open')).toBe(false);
  });

  it('rejects skipping a step', () => {
    expect(nextStatusIsValid('open', 'resolved')).toBe(false);
  });

  it('rejects a no-op and unknown statuses', () => {
    expect(nextStatusIsValid('open', 'open')).toBe(false);
    expect(nextStatusIsValid('open', 'closed')).toBe(false);
    expect(nextStatusIsValid(undefined, 'open')).toBe(false);
  });
});
