import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/qr.js', () => ({ toDataUrl: vi.fn(async () => 'data:image/png;base64,QR') }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(() => 'key'),
  extensionFor: vi.fn(() => 'jpg'),
}));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn(), getIO: vi.fn(), initRealtime: vi.fn() }));
vi.mock('../lib/discount.js', () => ({ issueDiscountCode: vi.fn() }));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));

import { createHash } from 'node:crypto';
import { query, queryOne } from '../db.js';
import { storage } from '../lib/storage.js';
import { issueDiscountCode } from '../lib/discount.js';
import guestRoutes from '../routes/guest.js';
import { createApp, request, ticketRow, SESSION_TOKEN, TICKET_ID, COMMUNITY_ID } from './helpers.js';

const app = createApp(guestRoutes, '/guest');

const MINE = 'aaaaaaaa-1111-4222-8333-444444444444';
const THEIRS = 'bbbbbbbb-1111-4222-8333-444444444444';
const hash = (id) => createHash('sha256').update(id).digest('hex');
const CARD = `/guest/cards/${COMMUNITY_ID}/A002`;

const openTicket = (overrides = {}) => ({
  wa_ref: 'H7M2QP',
  ticket_id: TICKET_ID,
  session_token: SESSION_TOKEN,
  status: 'parked',
  card_device_hash: null,
  community_name: 'The Leela Palace',
  ...overrides,
});

beforeEach(() => {
  queryOne.mockReset();
  query.mockReset();
  issueDiscountCode.mockReset();
});

// Card codes are sequential and printed. This endpoint used to give the
// session token -- the whole credential for a car -- to anyone who typed the
// next code along.
describe('GET /guest/cards: device binding', () => {
  it('binds an unbound open ticket to the first device and returns its token', async () => {
    queryOne
      .mockResolvedValueOnce(openTicket())
      .mockResolvedValueOnce({ card_device_hash: hash(MINE) });
    query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app, 'GET', CARD, { headers: { 'X-Valet-Device': MINE } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionToken: SESSION_TOKEN, locked: false, status: 'parked', waRef: 'H7M2QP' });
    const [sql, params] = query.mock.calls[0];
    // Conditional on still being unbound, so concurrent first scans race safely.
    expect(sql).toContain('card_device_hash IS NULL');
    // The hash is stored, never the raw id.
    expect(params).toEqual([TICKET_ID, hash(MINE)]);
    expect(JSON.stringify(params)).not.toContain(MINE);
  });

  it('gives the token back to the same device on a later scan, without rebinding', async () => {
    queryOne.mockResolvedValueOnce(openTicket({ card_device_hash: hash(MINE), status: 'with_guest' }));

    const res = await request(app, 'GET', CARD, { headers: { 'X-Valet-Device': MINE } });

    expect(res.body.sessionToken).toBe(SESSION_TOKEN);
    expect(res.body.status).toBe('with_guest');
    expect(query).not.toHaveBeenCalled();
  });

  it('locks a different device out, with no token and no WhatsApp reference', async () => {
    queryOne.mockResolvedValueOnce(openTicket({ card_device_hash: hash(MINE) }));

    const res = await request(app, 'GET', CARD, { headers: { 'X-Valet-Device': THEIRS } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionToken: null, locked: true, venueName: 'The Leela Palace', status: 'parked' });
    expect(res.body.waRef).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('locks the loser of two first scans racing each other', async () => {
    // Our UPDATE matched nothing; the re-read shows the other phone won.
    queryOne
      .mockResolvedValueOnce(openTicket())
      .mockResolvedValueOnce({ card_device_hash: hash(MINE) });
    query.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app, 'GET', CARD, { headers: { 'X-Valet-Device': THEIRS } });

    expect(res.body.locked).toBe(true);
    expect(res.body.sessionToken).toBeNull();
  });

  it('locks a request with no device header, and binds nothing for it', async () => {
    queryOne.mockResolvedValueOnce(openTicket());

    const res = await request(app, 'GET', CARD);

    expect(res.body).toMatchObject({ locked: true, sessionToken: null });
    expect(res.body.waRef).toBeUndefined();
    // A curl with no header must not be able to claim the card for nobody.
    expect(query).not.toHaveBeenCalled();
  });

  it('treats a malformed device id as missing', async () => {
    queryOne.mockResolvedValueOnce(openTicket());

    const res = await request(app, 'GET', CARD, { headers: { 'X-Valet-Device': 'short' } });

    expect(res.body.locked).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('still answers a card with no ticket on it, with the WhatsApp reference', async () => {
    queryOne.mockResolvedValueOnce({ wa_ref: 'H7M2QP', ticket_id: null, session_token: null, community_name: 'X' });

    const res = await request(app, 'GET', CARD);

    expect(res.body).toMatchObject({ waRef: 'H7M2QP', sessionToken: null, locked: false });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('POST /guest/tickets/:token/discount-optin: one code per ticket', () => {
  const closed = (hoursAgo) => ticketRow({
    status: 'final_closed',
    closed_at: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
  });

  it('returns the code already issued instead of minting another', async () => {
    queryOne
      .mockResolvedValueOnce(closed(1))
      .mockResolvedValueOnce({ code: 'DWAAR-FIRST1', expiry: 'x' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('DWAAR-FIRST1');
    expect(issueDiscountCode).not.toHaveBeenCalled();
  });

  it('issues the first one', async () => {
    queryOne.mockResolvedValueOnce(closed(1)).mockResolvedValueOnce(null);
    issueDiscountCode.mockResolvedValueOnce({ code: 'DWAAR-NEW123', expiry: 'x' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('DWAAR-NEW123');
  });

  it('answers the loser of a race with the winner\'s code', async () => {
    queryOne
      .mockResolvedValueOnce(closed(1))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ code: 'DWAAR-WINNER', expiry: 'x' });
    issueDiscountCode.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('DWAAR-WINNER');
  });

  it('refuses once the window after the close has passed', async () => {
    queryOne.mockResolvedValueOnce(closed(25));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('offer_expired');
    expect(issueDiscountCode).not.toHaveBeenCalled();
  });
});

describe('GET /guest/promotions/:id/image', () => {
  it('404s a non-uuid id without querying (it used to 500)', async () => {
    const res = await request(app, 'GET', '/guest/promotions/not-a-uuid/image');

    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
    expect(storage.getStream).not.toHaveBeenCalled();
  });
});
