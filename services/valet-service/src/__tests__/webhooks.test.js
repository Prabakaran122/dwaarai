import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../db.js', () => ({
  default: {}, query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn() }));
vi.mock('../lib/whatsapp-guest.js', () => ({
  notifyGuest: vi.fn(async () => ({ status: 'sent' })),
  notifyCardHeld: vi.fn(async () => ({ status: 'sent' })),
}));

import { query, queryOne } from '../db.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import webhookRoutes from '../routes/webhooks.js';
import { createApp, request } from './helpers.js';

process.env.WHATSAPP_WEBHOOK_SECRET = 'shh';
const app = createApp(webhookRoutes, '/webhooks');

function inbound(text, { messageId = 'wamid.1', from = '919876543210' } = {}) {
  return { messages: [{ id: messageId, from, type: 'text', text: { body: text } }] };
}
const sign = (body) =>
  crypto.createHmac('sha256', 'shh').update(JSON.stringify(body)).digest('hex');

const signedPost = (body) =>
  request(app, 'POST', '/webhooks/whatsapp', {
    body, headers: { 'x-whatsapp-signature': sign(body) },
  });

beforeEach(() => vi.clearAllMocks());

describe('POST /webhooks/whatsapp', () => {
  it('refuses an unsigned payload', async () => {
    const res = await request(app, 'POST', '/webhooks/whatsapp', { body: inbound('4K7QP2') });

    expect(res.status).toBe(401);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('refuses a payload whose signature does not match the body', async () => {
    const res = await request(app, 'POST', '/webhooks/whatsapp', {
      body: inbound('4K7QP2'),
      headers: { 'x-whatsapp-signature': sign(inbound('SOMETHINGELSE')) },
    });

    expect(res.status).toBe(401);
  });

  it('binds the number to the ticket the claim code names', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't1', claim_code: '4K7QP2', phone_number: null, status: 'parked' });

    const res = await signedPost(inbound('Hi, my code is 4K7QP2'));

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/phone_number/);
    expect(sql).toMatch(/whatsapp_last_inbound_at/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'bound');
  });

  it('acts on a redelivered message exactly once', async () => {
    queryOne.mockResolvedValueOnce({ id: 'seen' });

    const res = await signedPost(inbound('4K7QP2', { messageId: 'wamid.dup' }));

    // A provider retry must not re-bind or re-notify.
    expect(res.status).toBe(200);
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('acknowledges a message carrying no code, without acting on it', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await signedPost(inbound('hello?'));

    // A non-200 is retried forever, so unmatched still acknowledges.
    expect(res.status).toBe(200);
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('does not rebind a ticket that already belongs to another number', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't1', claim_code: '4K7QP2', phone_number: '919876543210', status: 'parked' });

    await signedPost(inbound('4K7QP2', { from: '919000000000' }));

    // A valet stand is a public place; a ticket must not migrate to whoever
    // scanned the screen last.
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/SET[\s\S]*phone_number\s*=\s*\$2/);
  });
});

describe('asking for the car from WhatsApp', () => {
  // Already bound, so an inbound is a command rather than a first contact.
  const bound = (status) => ({
    id: 't1', claim_code: '4K7QP2', phone_number: '919876543210',
    status, community_name: 'The Leela', display_id: 'DWR-0042',
  });

  it('requests the car when it is parked', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('parked'));

    await signedPost(inbound('4K7QP2 CAR'));

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'retrieval_requested'/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'accepted');
  });

  it('does not request a car that is already on its way', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('en_route'));

    await signedPost(inbound('4K7QP2 CAR'));

    // Requesting twice sends a second valet for the same car.
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/status\s*=\s*'retrieval_requested'/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'en_route');
  });

  it('replies with where things stand when the message is not a request', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('parked'));

    await signedPost(inbound('4K7QP2 thanks!'));

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/status\s*=\s*'retrieval_requested'/);
    // Silence reads as a broken channel to a guest who just typed something.
    expect(notifyGuest).toHaveBeenCalled();
  });

  it('sends the link when the car is already at the pickup point', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('arrived'));

    await signedPost(inbound('4K7QP2 where is my car'));

    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'arrived');
  });
});

describe('a guest who was faster than the guard', () => {
  it('holds the number on the card when no ticket exists yet', async () => {
    queryOne
      .mockResolvedValueOnce(null)                                      // not a duplicate
      .mockResolvedValueOnce(null)                                      // no ticket on that claim code
      .mockResolvedValueOnce({ id: 'card-1', community_name: 'The Leela', ticket_id: null });

    const res = await signedPost(inbound('H7M2QP'));

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    // Held on the card, because the ticket it will belong to does not exist.
    expect(sql).toMatch(/pending_wa_phone/);
  });

  it('binds immediately when the card already has a ticket', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'card-1', community_name: 'The Leela', ticket_id: 't1',
        session_token: 'tok', claim_code: '4K7QP2', phone_number: null, status: 'parked',
      });

    await signedPost(inbound('H7M2QP'));

    expect(notifyGuest).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'bound');
  });
});

describe('an MSG91-shaped delivery', () => {
  /** What MSG91 actually posts: its own fields, body as a JSON string. */
  const msg91 = (text, { messageId = 'wamid.m1', from = '919876543210' } = {}) => ({
    messageId, from, content: JSON.stringify({ text }),
  });

  it('requests the car, exactly as a Meta-shaped one would', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 't1', claim_code: '4K7QP2', phone_number: '919876543210',
      status: 'parked', community_name: 'The Leela', display_id: 'DWR-0042',
    });

    // Before the normaliser this parsed to nothing and answered "ok" -- every
    // guest message on the configured provider silently ignored, with a 200
    // telling MSG91 it had been handled.
    await signedPost(msg91('4K7QP2 CAR'));

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'retrieval_requested'/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'accepted');
  });

  it('still answers 200 for a delivery report carrying no message', async () => {
    const res = await signedPost({ status: 'delivered', messageId: 'wamid.x' });

    // No text to act on, but a 4xx would make MSG91 retry a report four times.
    expect(res.status).toBe(200);
  });
});

describe('providers that cannot sign', () => {
  /**
   * authkey.io's webhook console offers a URL, a method and a JSON toggle --
   * and no signing secret of any kind. HMAC was designed here for MSG91 and
   * would reject every message this provider ever sends.
   *
   * The fallback is a secret carried in the URL, which is what a provider
   * without signing can actually do. It is weaker than HMAC -- it does not
   * prove the body is untampered -- so it is only consulted when no signature
   * is offered, and compared in constant time like the real thing.
   */
  const inboundBody = { messageId: 'wamid.tok1', from: '919876543210', content: JSON.stringify({ text: '4K7QP2 CAR' }) };

  it('accepts a request carrying the shared token in the URL', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 't1', claim_code: '4K7QP2', phone_number: '919876543210',
      status: 'parked', community_name: 'The Leela', display_id: 'DWR-0042',
    });

    const res = await request(app, 'POST', '/webhooks/whatsapp?token=shh', { body: inboundBody });

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'retrieval_requested'/);
  });

  it('refuses a wrong token', async () => {
    const res = await request(app, 'POST', '/webhooks/whatsapp?token=nope', { body: inboundBody });
    expect(res.status).toBe(401);
  });

  it('still refuses a request with neither signature nor token', async () => {
    const res = await request(app, 'POST', '/webhooks/whatsapp', { body: inboundBody });
    expect(res.status).toBe(401);
  });

  it('still accepts a properly signed request, so MSG91 keeps working', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 't1', claim_code: '4K7QP2', phone_number: '919876543210',
      status: 'parked', community_name: 'The Leela', display_id: 'DWR-0042',
    });

    const res = await signedPost(inbound('4K7QP2 CAR', { messageId: 'wamid.sig1' }));
    expect(res.status).toBe(200);
  });
});

describe('a guest who replies exactly as we told them to', () => {
  const ak = (text, from = '919003143250') => ({
    channel: 'wapp',
    eventContent: { message: { id: `wamid.${text}${from}`, from, text: { body: text } } },
  });
  const post = (b) => request(app, 'POST', '/webhooks/whatsapp?token=shh', { body: b });

  it('finds their car from the phone number alone', async () => {
    // "Reply CAR when you want it brought round" is what the welcome message
    // says. CAR is three characters; the claim-code pattern needs six, so this
    // resolved to nothing and the guest was ignored -- by the one instruction
    // we actually gave them.
    // No code in "CAR", so the code lookup never runs: dedup, then phone.
    queryOne
      .mockResolvedValueOnce(null)                                   // dedup
      .mockResolvedValueOnce({                                       // by phone
        id: 't1', claim_code: '4K7QP2', phone_number: '919003143250',
        status: 'parked', community_name: 'The Leela', display_id: 'DWR-0042',
      });

    await post(ak('CAR'));

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'retrieval_requested'/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'accepted');
  });

  it('still says nothing useful to a stranger with no ticket', async () => {
    queryOne
      .mockResolvedValueOnce(null)   // dedup
      .mockResolvedValueOnce(null);  // by phone: nothing

    const res = await post(ak('CAR', '910000000000'));

    expect(res.body.unmatched).toBe(true);
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('prefers the code when one is given, over the phone lookup', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 't-code', claim_code: '4K7QP2', phone_number: '919003143250',
        status: 'parked', community_name: 'The Leela', display_id: 'DWR-0042',
      });

    await post(ak('4K7QP2 CAR'));

    // A guest holding a card for a different car must reach that car, not
    // whichever ticket their number happens to be on.
    const byPhone = queryOne.mock.calls.filter((c) => /phone_number\s*=/.test(c[0]));
    expect(byPhone).toHaveLength(0);
  });
});

describe('a number written one way and messaged from another', () => {
  const ak = (text, from = '919003143250') => ({
    channel: 'wapp',
    eventContent: { message: { id: `wamid.${text}${from}`, from, text: { body: text } } },
  });
  const post = (b) => request(app, 'POST', '/webhooks/whatsapp?token=shh', { body: b });

  it('finds a ticket whose number the guard typed without a country code', async () => {
    queryOne
      .mockResolvedValueOnce(null)   // dedup
      .mockResolvedValueOnce({       // by phone
        id: 't10', claim_code: 'B73V5M', phone_number: '9003143250',
        status: 'parked', community_name: 'Palm Meadows', display_id: 'DWR-0010',
      });

    await post(ak('CAR'));

    // The guard types ten digits; WhatsApp delivers twelve. Matching with '='
    // meant a guest could never reach a ticket a guard had entered by hand.
    const lookup = queryOne.mock.calls.find((c) => /phone/i.test(c[0]));
    expect(lookup[0]).toMatch(/RIGHT\(/i);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'retrieval_requested'/);
  });

  it('treats the guest as the bound one despite the shorter stored form', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 't10', claim_code: 'B73V5M', phone_number: '9003143250',
        status: 'parked', community_name: 'Palm Meadows', display_id: 'DWR-0010',
      });

    const res = await post(ak('CAR'));

    // Not "already bound to someone else" -- it is the same person.
    expect(res.body.alreadyBound).toBeUndefined();
  });
});
