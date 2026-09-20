import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRecognitionConfigured, matchAttendant } from '../lib/face.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.FACE_RECOGNITION_URL = 'http://face:9000';
});
afterEach(() => { process.env = { ...ORIGINAL }; });

const vector = Buffer.from('enrolled-vector');

describe('verifying the attendant at shift start', () => {
  it('confirms a match above the threshold', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ matched: true, confidence: 0.93 }),
    }));

    expect(await matchAttendant('scan', vector)).toEqual({
      available: true, verified: true, confidence: 0.93,
    });
  });

  it('reports a failed match as a failed match, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ matched: false, confidence: 0.31 }),
    }));

    // Somebody else holding the phone is the thing this exists to catch, and
    // it is an answer rather than a fault.
    expect(await matchAttendant('scan', vector)).toEqual({
      available: true, verified: false, confidence: 0.31,
    });
  });

  it('is unavailable rather than false when no service is configured', async () => {
    delete process.env.FACE_RECOGNITION_URL;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    // "We could not check" and "we checked and it was not them" must never
    // collapse into the same answer in an audit trail.
    expect(await matchAttendant('scan', vector)).toEqual({ available: false });
    expect(isRecognitionConfigured()).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('is unavailable when the attendant has never enrolled', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    expect(await matchAttendant('scan', null)).toEqual({ available: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('is unavailable, not verified, when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    expect(await matchAttendant('scan', vector)).toEqual({ available: false });
  });
});
