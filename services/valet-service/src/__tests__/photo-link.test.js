import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/qr.js', () => ({ toDataUrl: vi.fn(async () => 'data:image/png;base64,QR') }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(() => 'valet/photo/t/key.jpg'),
  extensionFor: vi.fn(() => 'jpg'),
}));
vi.mock('../lib/anpr.js', () => ({ readPlate: vi.fn(async () => null), isConfigured: vi.fn(() => true) }));
vi.mock('../lib/whatsapp-guest.js', () => ({ notifyGuest: vi.fn(async () => ({ status: 'sent' })) }));
vi.mock('../lib/sms.js', () => ({ sendClaimCode: vi.fn(async () => ({ status: 'sent' })) }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn(), getIO: vi.fn(), initRealtime: vi.fn() }));
vi.mock('../lib/expiry.js', () => ({ schedulePhotoDeletion: vi.fn(), scheduleConditionMediaDeletion: vi.fn() }));

import jwt from 'jsonwebtoken';
import { queryOne } from '../db.js';
import { storage } from '../lib/storage.js';
import guardRoutes from '../routes/guard.js';
import { signPhotoLink } from '../lib/photo-link.js';
import { createApp, request, ticketRow, guardToken, SESSION_TOKEN, TICKET_ID, COMMUNITY_ID } from './helpers.js';

const app = createApp(guardRoutes, '/guard');

beforeEach(() => vi.clearAllMocks());

// The handover screen used to load the photo with an Authorization header on
// the <Image> source. React Native's native loader dropped it, so the request
// arrived anonymous, 401'd, and the guard was asked to confirm "Person
// matches" against an empty frame. A short-lived signed link needs no header.
describe('POST /guard/tickets/:token/photo-link', () => {
  it('requires a guard', async () => {
    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/photo-link`);
    expect(res.status).toBe(401);
  });

  it('issues a short-lived link for a ticket that has a photo', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce({ storage_key: 'valet/photo/t/key.jpg' });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/photo-link`, { token: guardToken() });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/guard\/photo-links\/[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(res.body.expiresIn).toBeLessThanOrEqual(120);
  });

  it('404s rather than signing a link to nothing', async () => {
    queryOne.mockResolvedValueOnce(ticketRow()).mockResolvedValueOnce(null);

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/photo-link`, { token: guardToken() });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_photo');
  });
});

describe('GET /guard/photo-links/:sig', () => {
  it('serves the photo with no Authorization header, typed as an image', async () => {
    queryOne.mockResolvedValueOnce({ storage_key: 'valet/photo/t/key.jpg' });
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.from('jpegbytes')]));

    const res = await request(app, 'GET', `/guard/photo-links/${signPhotoLink(TICKET_ID, COMMUNITY_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(queryOne.mock.calls[0][1]).toEqual([TICKET_ID, COMMUNITY_ID]);
  });

  it('refuses a tampered or foreign signature', async () => {
    const forged = jwt.sign({ purpose: 'guest_photo', tid: TICKET_ID, cid: COMMUNITY_ID }, 'not-our-secret');
    const res = await request(app, 'GET', `/guard/photo-links/${forged}`);
    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('refuses an expired link', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sig = signPhotoLink(TICKET_ID, COMMUNITY_ID);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    const res = await request(app, 'GET', `/guard/photo-links/${sig}`);
    vi.useRealTimers();
    expect(res.status).toBe(404);
  });

  it('refuses an ordinary guard JWT presented as a link', async () => {
    const res = await request(app, 'GET', `/guard/photo-links/${guardToken()}`);
    expect(res.status).toBe(404);
  });

  it('404s once the photo has been deleted by retention', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'GET', `/guard/photo-links/${signPhotoLink(TICKET_ID, COMMUNITY_ID)}`);
    expect(res.status).toBe(404);
  });
});
