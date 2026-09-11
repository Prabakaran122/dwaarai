import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../db.js', () => ({
  default: {}, query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn() }));
vi.mock('../lib/whatsapp-guest.js', () => ({
  notifyGuest: vi.fn(async () => ({ status: 'sent' })),
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
