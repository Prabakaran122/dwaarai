import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { sendText, sendTemplate, verifySignature, isConfigured } from '../lib/whatsapp.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.WHATSAPP_PROVIDER = 'msg91';
  process.env.MSG91_AUTH_KEY = 'test-key';
  process.env.WHATSAPP_NUMBER = '919999900000';
  process.env.WHATSAPP_WEBHOOK_SECRET = 'shh';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('whatsapp transport', () => {
  it('sends a free-form message to the guest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendText('919876543210', 'Your car is on its way')).toEqual({ status: 'sent' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // payload.to, not body.to -- this assertion used to encode the bug.
    expect(body.payload.to).toBe('919876543210');
    expect(JSON.stringify(body)).toContain('Your car is on its way');
  });

  it('reports skipped rather than success when no provider is configured', async () => {
    delete process.env.WHATSAPP_PROVIDER;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // The silent no-op is the trap: a deployment with no credentials must say
    // it sent nothing rather than report success.
    expect(await sendText('919876543210', 'hi')).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isConfigured()).toBe(false);
  });

  it('never throws when the provider is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    expect(await sendText('919876543210', 'hi')).toEqual({ status: 'failed' });
  });

  it('sends a template with its variables in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendTemplate('919876543210', 'car_ready', ['The Leela', 'DWR-0042']);

    const body = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body));
    expect(body).toContain('car_ready');
    expect(body).toContain('The Leela');
  });

  it('accepts a signature computed over the raw body', () => {
    const raw = '{"hello":"world"}';
    const sig = crypto.createHmac('sha256', 'shh').update(raw).digest('hex');

    expect(verifySignature(raw, sig)).toBe(true);
  });

  it('rejects a tampered body, a wrong signature and a missing one', () => {
    const sig = crypto.createHmac('sha256', 'shh').update('{"a":1}').digest('hex');

    expect(verifySignature('{"a":2}', sig)).toBe(false);
    expect(verifySignature('{"a":1}', 'deadbeef')).toBe(false);
    expect(verifySignature('{"a":1}', '')).toBe(false);
  });
});

/**
 * Shape, not substrings.
 *
 * These assert the structure MSG91's own SDK validator enforces
 * (Walkover-Web-Solution/msg91-whatsapp-sdk-ruby, core/request_handler.rb).
 * The older test above only checked that the serialised body *contained*
 * "car_ready" -- which it did, while sitting in fields MSG91 rejects.
 */
describe('MSG91 wire format', () => {
  function captureBody(fn) {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);
    return fn().then(() => JSON.parse(fetchMock.mock.calls[0][1].body));
  }

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'msg91';
    process.env.MSG91_AUTH_KEY = 'k';
    process.env.WHATSAPP_NUMBER = '919000000000';
  });

  it('puts the recipient in to_and_components, not at the top level', async () => {
    const body = await captureBody(() => sendTemplate('919876543210', 'car_ready', ['The Leela']));

    // The bulk endpoint has no top-level `to`. Sending one puts the number
    // nowhere MSG91 looks, and the message goes to nobody.
    expect(body.to).toBeUndefined();
    expect(body.payload.template.to_and_components).toBeInstanceOf(Array);
    expect(body.payload.template.to_and_components[0].to).toBe('919876543210');
  });

  it('carries the template variables under that recipient', async () => {
    const body = await captureBody(() => sendTemplate('919876543210', 'car_ready', ['The Leela', 'DWR-0042']));
    const entry = body.payload.template.to_and_components[0];

    expect(entry.components).toBeInstanceOf(Array);
    expect(JSON.stringify(entry.components)).toContain('The Leela');
    expect(JSON.stringify(entry.components)).toContain('DWR-0042');
  });

  it('names the template and its language the way MSG91 expects', async () => {
    const body = await captureBody(() => sendTemplate('919876543210', 'car_ready', []));

    expect(body.content_type).toBe('template');
    expect(body.integrated_number).toBe('919000000000');
    expect(body.payload.type).toBe('template');
    expect(body.payload.template.name).toBe('car_ready');
    // A string, not { code: 'en' } -- that is Meta's Cloud API shape, not this one.
    expect(body.payload.template.language).toBe('en');
  });

  it('puts a session message inside payload, where the single-send shape wants it', async () => {
    const body = await captureBody(() => sendText('919876543210', 'Your car is on its way'));

    expect(body.content_type).toBe('text');
    expect(body.to).toBeUndefined();
    expect(body.payload.to).toBe('919876543210');
    expect(body.payload.type).toBe('text');
    expect(body.payload.messaging_product).toBe('whatsapp');
    expect(body.payload.text.body).toBe('Your car is on its way');
  });
});

/**
 * Inbound normalisation.
 *
 * MSG91 does not forward Meta's shape. It posts its own fields with the
 * message body as a JSON *string* in `content`, and which fields arrive is
 * configurable per webhook. The route was reading Meta's messages[0] and
 * would have seen nothing at all from a real MSG91 delivery.
 */
describe('inbound normalisation', () => {
  it('reads an MSG91 delivery, whose body is a JSON string', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');

    const msg = normalizeInbound({
      messageId: 'wamid.ABC',
      from: '919876543210',
      content: JSON.stringify({ text: 'DWR042 my car please' }),
    });

    expect(msg).toEqual({ id: 'wamid.ABC', from: '919876543210', text: 'DWR042 my car please' });
  });

  it('reads a Meta Cloud API delivery too, so the provider can be swapped', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');

    const msg = normalizeInbound({
      messages: [{ id: 'wamid.XYZ', from: '919000000000', text: { body: 'DWR099' } }],
    });

    expect(msg).toEqual({ id: 'wamid.XYZ', from: '919000000000', text: 'DWR099' });
  });

  it('survives a content string that is not JSON', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');

    const msg = normalizeInbound({ messageId: 'm1', from: '9190', content: 'DWR042' });

    // A provider that sends plain text rather than a JSON envelope must not
    // throw its way into a 500 and a retry storm.
    expect(msg.text).toBe('DWR042');
    expect(msg.id).toBe('m1');
  });

  it('returns null when there is no message to act on', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');

    expect(normalizeInbound({})).toBeNull();
    expect(normalizeInbound({ messages: [] })).toBeNull();
    expect(normalizeInbound(undefined)).toBeNull();
  });
});
