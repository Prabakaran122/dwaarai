import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/whatsapp-guest.js', () => ({
  notifyGuest: vi.fn(async () => ({ status: 'sent' })),
}));

import { query, queryOne, queryRows } from '../db.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import adminRoutes, { cardState } from '../routes/admin.js';
import { createApp, request, guardToken, adminToken, COMMUNITY_ID } from './helpers.js';

const app = createApp(adminRoutes, '/admin');

beforeEach(() => {
  vi.clearAllMocks();
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
});

describe('cardState: where a card is, in the cards page\'s words', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();

  it('reads a card with no open ticket as available, and a retired one as out of use', () => {
    expect(cardState({ is_active: true, display_id: null }, now)).toBe('available');
    expect(cardState({ is_active: false, display_id: null }, now)).toBe('out_of_use');
  });

  it('is waiting for a scan until a guest phone opens it, then with a guest', () => {
    const base = { is_active: true, display_id: 'DWR-1', ticket_created_at: hoursAgo(1) };
    expect(cardState({ ...base, card_bound_at: null }, now)).toBe('waiting_scan');
    expect(cardState({ ...base, card_bound_at: hoursAgo(0.5) }, now)).toBe('with_guest');
  });

  it('is overdue once its ticket is more than a day old, scanned or not', () => {
    expect(cardState({ is_active: true, display_id: 'DWR-1', ticket_created_at: hoursAgo(26), card_bound_at: hoursAgo(25) }, now))
      .toBe('overdue');
    expect(cardState({ is_active: true, display_id: 'DWR-1', ticket_created_at: hoursAgo(26), card_bound_at: null }, now))
      .toBe('overdue');
  });
});

describe('GET /admin/cards/:id/history', () => {
  it('returns the card\'s last ten visits, scoped to the venue', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1', code: 'A001' });
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-9', plate: 'KA03NJ0435', vehicle_make: 'Swift', status: 'final_closed',
      session_token: 'tok', created_at: 'a', closed_at: 'b', handed_out_by: 'Ramesh',
    }]);

    const res = await request(app, 'GET', '/admin/cards/c1/history', { token: adminToken() });

    expect(queryOne.mock.calls[0][1]).toEqual(['c1', COMMUNITY_ID]);
    expect(queryRows.mock.calls[0][0]).toContain('LIMIT 10');
    expect(res.body.uses[0]).toMatchObject({ displayId: 'DWR-9', handedOutBy: 'Ramesh' });
  });

  it('404s another venue\'s card', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'GET', '/admin/cards/c1/history', { token: adminToken() });
    expect(res.status).toBe(404);
  });

  it('requires an admin', async () => {
    const res = await request(app, 'GET', '/admin/cards/c1/history', { token: guardToken() });
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/cards/:id/resend', () => {
  it('sends the WhatsApp ticket again and records it', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c1', code: 'A001' })
      .mockResolvedValueOnce({ id: 't1', phone_number: '919800000000', display_id: 'DWR-9' });

    const res = await request(app, 'POST', '/admin/cards/c1/resend', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(notifyGuest).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'bound');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['t1', 'ticket_resent']));
  });

  it('says so when the guest has no WhatsApp chat to resend into', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c1', code: 'A001' })
      .mockResolvedValueOnce({ id: 't1', phone_number: null });

    const res = await request(app, 'POST', '/admin/cards/c1/resend', { token: adminToken() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_whatsapp');
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('refuses a card that is not with a guest', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1', code: 'A001' }).mockResolvedValueOnce(null);
    const res = await request(app, 'POST', '/admin/cards/c1/resend', { token: adminToken() });
    expect(res.body.error).toBe('card_not_in_use');
  });
});

describe('POST /admin/cards/:id/return', () => {
  it('frees the card from its open ticket and leaves the ticket running', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'c1', code: 'A017' })
      .mockResolvedValueOnce({ id: 't1', display_id: 'DWR-17' });

    const res = await request(app, 'POST', '/admin/cards/c1/return', { token: adminToken() });

    expect(res.status).toBe(200);
    const sql = queryOne.mock.calls[1][0];
    expect(sql).toContain('SET card_id = NULL');
    // The ticket's own status is untouched: the car is still with us.
    expect(sql).not.toContain('status =');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['t1', 'card_returned']));
  });

  it('409s a card that is already free', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1', code: 'A017' }).mockResolvedValueOnce(null);
    const res = await request(app, 'POST', '/admin/cards/c1/return', { token: adminToken() });
    expect(res.status).toBe(409);
  });
});

describe('POST /admin/staff/:id/pin', () => {
  it('stores a hash of the new PIN, scoped to the venue', async () => {
    queryOne.mockResolvedValueOnce({ id: 's1' });

    const res = await request(app, 'POST', '/admin/staff/s1/pin', { token: adminToken(), body: { pin: '4821' } });

    expect(res.status).toBe(200);
    const [sql, params] = queryOne.mock.calls[0];
    expect(sql).toContain("type = 'guard'");
    expect(params.slice(0, 2)).toEqual(['s1', COMMUNITY_ID]);
    // Never the PIN itself.
    expect(params[2]).not.toBe('4821');
    expect(params[2]).toMatch(/^\$2[aby]\$/);
  });

  it('refuses a PIN under four characters', async () => {
    const res = await request(app, 'POST', '/admin/staff/s1/pin', { token: adminToken(), body: { pin: '12' } });
    expect(res.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('404s someone who is not staff at this venue', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'POST', '/admin/staff/s9/pin', { token: adminToken(), body: { pin: '4821' } });
    expect(res.status).toBe(404);
  });

  it('requires an admin', async () => {
    const res = await request(app, 'POST', '/admin/staff/s1/pin', { token: guardToken(), body: { pin: '4821' } });
    expect(res.status).toBe(403);
  });
});
