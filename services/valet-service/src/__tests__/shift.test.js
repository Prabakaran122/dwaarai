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
vi.mock('../lib/face.js', () => ({
  isRecognitionConfigured: vi.fn(() => true),
  matchAttendant: vi.fn(async () => ({ available: false })),
}));

import { query, queryOne } from '../db.js';
import { matchAttendant } from '../lib/face.js';
import { storage } from '../lib/storage.js';
import guardRoutes from '../routes/guard.js';
import { createApp, request, guardToken } from './helpers.js';

const app = createApp(guardRoutes, '/guard');
const token = guardToken();

beforeEach(() => vi.clearAllMocks());

describe('POST /guard/shift/start', () => {
  it('opens the shift without keeping the selfie', async () => {
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    expect(res.status).toBe(201);
    // The image goes to the recogniser and nowhere else.
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('says which of the three things happened when it could not confirm', async () => {
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // The reference build treats any captured selfie as verified. That is a
    // fabricated result. Not enrolled, not configured and no match are three
    // different facts and the response says which.
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('attendant_not_enrolled');
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

describe('shift start, once recognition is wired', () => {
  it('records a confirmed attendant', async () => {
    queryOne.mockResolvedValueOnce({ vector: Buffer.from('v') });
    vi.mocked(matchAttendant).mockResolvedValueOnce({ available: true, verified: true, confidence: 0.93 });
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    expect(res.body.verified).toBe(true);
    expect(res.body.confidence).toBeCloseTo(0.93);
  });

  it('records a failed match as failed, and still opens the shift', async () => {
    queryOne.mockResolvedValueOnce({ vector: Buffer.from('v') });
    vi.mocked(matchAttendant).mockResolvedValueOnce({ available: true, verified: false, confidence: 0.2 });
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // Locking somebody out on a face score would strand a real attendant over
    // a bad light. The record says what happened; a manager decides.
    expect(res.status).toBe(201);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('no_match');
  });

  it('never stores the selfie', async () => {
    queryOne.mockResolvedValueOnce({ vector: Buffer.from('v') });
    vi.mocked(matchAttendant).mockResolvedValueOnce({ available: true, verified: true, confidence: 0.9 });
    query.mockResolvedValue({});

    await request(app, 'POST', '/guard/shift/start', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // face_enrollments holds a vector and never a photograph, which is the
    // whole reason it is safe to hold. A selfie per shift would undo that.
    expect(storage.put).not.toHaveBeenCalled();
  });
});
