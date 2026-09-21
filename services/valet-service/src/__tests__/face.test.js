import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vectorize, matchAttendant, isRecognitionConfigured } from '../lib/face.js';

const realFetch = global.fetch;
beforeEach(() => {
  process.env.FACE_RECOGNITION_URL = 'http://face.local';
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.FACE_RECOGNITION_URL;
});

/** A vector the way the service sends it: float32 bytes, base64. */
function serviceVector(nums) {
  return Buffer.from(Float32Array.from(nums).buffer).toString('base64');
}

describe('storing what the recogniser returns', () => {
  it('decodes the base64 rather than storing the text of it', async () => {
    const b64 = serviceVector([0.1, 0.2, 0.3]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vector: b64 }) });

    const stored = await vectorize('scan');

    // Buffer.from(b64) without an encoding stores the ASCII of the base64,
    // which is longer than the vector and decodes to nothing. Sent back to
    // /match it arrives double-encoded, so an enrolment could never match the
    // person who made it -- silently, and only once a recogniser existed.
    expect(stored.length).toBe(12);
    expect(stored.toString('base64')).toBe(b64);
  });

  it('accepts a plain array of numbers too', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vector: [0.5, 0.25] }) });

    const stored = await vectorize('scan');

    expect(stored.length).toBe(8);
    expect(Array.from(new Float32Array(stored.buffer, stored.byteOffset, 2))).toEqual([0.5, 0.25]);
  });

  it('returns null when there is no recogniser, so nothing is half-enrolled', async () => {
    delete process.env.FACE_RECOGNITION_URL;
    expect(await vectorize('scan')).toBeNull();
    expect(isRecognitionConfigured()).toBe(false);
  });
});

describe('matching an attendant', () => {
  it('sends the stored vector back in the shape it came in', async () => {
    const b64 = serviceVector([0.1, 0.2, 0.3]);
    const stored = Buffer.from(b64, 'base64');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ matched: true, confidence: 0.97 }),
    });
    global.fetch = fetchMock;

    const res = await matchAttendant('selfie', stored);

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.candidates[0].vector).toBe(b64);
    expect(res).toEqual({ available: true, verified: true, confidence: 0.97 });
  });

  it('says the check did not happen when the service is down', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('refused'));

    // Not the same as "it was not them".
    expect(await matchAttendant('selfie', Buffer.from('v'))).toEqual({ available: false });
  });
});
