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
