import { describe, it, expect } from 'vitest';
import { UPVOTE_THRESHOLD, crossedThreshold } from '../routes/issues.js';

describe('upvote threshold', () => {
  it('fires exactly once, on the crossing', () => {
    expect(crossedThreshold(UPVOTE_THRESHOLD - 1, UPVOTE_THRESHOLD)).toBe(true);
  });

  it('does not fire before, after, or on the way down', () => {
    expect(crossedThreshold(0, 1)).toBe(false);
    expect(crossedThreshold(UPVOTE_THRESHOLD, UPVOTE_THRESHOLD + 1)).toBe(false);
    expect(crossedThreshold(UPVOTE_THRESHOLD, UPVOTE_THRESHOLD - 1)).toBe(false);
  });
});
