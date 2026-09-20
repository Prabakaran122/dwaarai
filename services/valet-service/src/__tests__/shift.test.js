import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {}, query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(async () => {}), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(() => 'valet/shift/g1/selfie.jpg'),
  extensionFor: vi.fn(() => 'jpg'),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));

import { query } from '../db.js';
import { storage } from '../lib/storage.js';
import guardRoutes from '../routes/guard.js';
import { createApp, request, guardToken } from './helpers.js';

const app = createApp(guardRoutes, '/guard');
const token = guardToken();

beforeEach(() => vi.clearAllMocks());

describe('POST /guard/shift/start', () => {
  it('stores the selfie and opens the shift', async () => {
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    expect(res.status).toBe(201);
    expect(storage.put).toHaveBeenCalled();
  });

  it('says plainly that no recognition ran', async () => {
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // The reference build treats any captured selfie as "verified". That is a
    // fabricated result, and an audit trail that claims a check happened is
    // worse than one that admits it did not.
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('recognition_not_configured');
  });

  it('opens a shift even with no camera, rather than locking the attendant out', async () => {
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', { token, body: {} });

    // A denied camera at 6am must not be the thing that stops a shift.
    expect(res.status).toBe(201);
    expect(res.body.photo).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
