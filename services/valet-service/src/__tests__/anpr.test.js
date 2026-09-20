import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readPlate, isConfigured } from '../lib/anpr.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.ANPR_SERVICE_URL = 'http://anpr:8001';
});
afterEach(() => { process.env = { ...ORIGINAL }; });

const img = Buffer.from('jpegbytes');

describe('reading a plate off the intake photo', () => {
  it('returns the plate when the service is confident', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plate: 'KA03NJ0435', confidence: 0.94, above_threshold: true }),
    }));

    expect(await readPlate(img, 'image/jpeg')).toEqual({
      plate: 'KA03NJ0435', confidence: 0.94,
    });
  });

  it('returns nothing when the service is not confident', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plate: 'KAO3NJO435', confidence: 0.4, above_threshold: false }),
    }));

    // A low-confidence guess pre-filled into the field is worse than an empty
    // one: the attendant stops reading it and starts confirming it.
    expect(await readPlate(img, 'image/jpeg')).toBeNull();
  });

  it('is inert when no service is configured', async () => {
    delete process.env.ANPR_SERVICE_URL;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    expect(isConfigured()).toBe(false);
    expect(await readPlate(img, 'image/jpeg')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('never throws when the service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    // The attendant types the plate either way. A reading service being down
    // must not be something that stops a car being taken in.
    expect(await readPlate(img, 'image/jpeg')).toBeNull();
  });

  it('normalises what it reads, so a confusable never reaches the field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plate: 'ka 03 nj 0435', confidence: 0.99, above_threshold: true }),
    }));

    expect((await readPlate(img, 'image/jpeg')).plate).toBe('KA03NJ0435');
  });
});
