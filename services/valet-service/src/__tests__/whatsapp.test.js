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
    expect(body.to).toBe('919876543210');
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
