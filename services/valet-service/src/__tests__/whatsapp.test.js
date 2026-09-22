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

/**
 * authkey.io is a different API in every respect: GET/POST to console.authkey.io,
 * Basic auth rather than an authkey header, a numeric template id (`wid`) instead
 * of a name, named bodyValues instead of an ordered array, and the country code
 * split out of the number.
 */
describe('authkey.io transport', () => {
  function capture(fn, response = { success: true }) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal('fetch', fetchMock);
    return fn().then((result) => ({
      url: fetchMock.mock.calls[0]?.[0],
      init: fetchMock.mock.calls[0]?.[1],
      body: fetchMock.mock.calls[0] ? JSON.parse(fetchMock.mock.calls[0][1].body) : null,
      result,
    }));
  }

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.AUTHKEY_API_KEY = 'testkey';
    process.env.WHATSAPP_NUMBER = '919000000000';
  });

  it('is configured by its own key, not MSG91 s', async () => {
    const { isConfigured } = await import('../lib/whatsapp.js');
    expect(isConfigured()).toBe(true);

    delete process.env.AUTHKEY_API_KEY;
    expect(isConfigured()).toBe(false);
  });

  it('needs no sender number, because the account implies it', async () => {
    const { isConfigured } = await import('../lib/whatsapp.js');
    delete process.env.WHATSAPP_NUMBER;

    // authkey.io takes only the recipient; the sender is whatever number the
    // account has registered, and it exposes no API to read it back. Demanding
    // one here would leave every message silently skipped.
    expect(isConfigured()).toBe(true);
  });

  it('posts a template to requestjson.php with Basic auth', async () => {
    const { url, init, body } = await capture(() => sendTemplate('919876543210', '4821', ['The Leela']));

    expect(url).toBe('https://console.authkey.io/restapi/requestjson.php');
    expect(init.headers.Authorization).toBe('Basic testkey');
    expect(body.wid).toBe('4821');
  });

  it('splits the country code out of the number', async () => {
    const { body } = await capture(() => sendTemplate('919876543210', '4821', []));

    // The provider wants them apart; our waId is one international string.
    expect(body.country_code).toBe('91');
    expect(body.mobile).toBe('9876543210');
  });

  it('accepts a number that already lacks a country code', async () => {
    const { body } = await capture(() => sendTemplate('9876543210', '4821', []));
    expect(body.country_code).toBe('91');
    expect(body.mobile).toBe('9876543210');
  });

  it('names the variables var1..varN, which is how the template reads them', async () => {
    const { body } = await capture(() => sendTemplate('919876543210', '4821', ['The Leela', 'DWR-0042']));

    expect(body.bodyValues).toEqual({ var1: 'The Leela', var2: 'DWR-0042' });
  });

  it('reports failure when the provider says the send failed', async () => {
    const { result } = await capture(
      () => sendTemplate('919876543210', '4821', []),
      { success: false, message: 'Invalid authkey or expired user' }
    );

    // success:false with HTTP 200 is this provider's normal failure shape;
    // reading only the status code would call it sent.
    expect(result).toEqual({ status: 'failed' });
  });

  it('skips rather than claiming success when nothing is configured', async () => {
    delete process.env.AUTHKEY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendTemplate('919876543210', '4821', [])).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The send endpoint does not answer like the balance endpoint.
 *
 * getbalance.php returns { success: true }; requestjson.php returns
 * { status: 'Success', LogID, Message }. Reading the send response for a
 * `success` boolean called every real delivery a failure -- which, through
 * the template fallback, means the guest is messaged twice.
 */
describe('authkey.io response shapes', () => {
  function withResponse(payload) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    return sendTemplate('919876543210', '49385', ['a']);
  }

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.AUTHKEY_API_KEY = 'testkey';
  });

  it('reads the real success shape from requestjson.php', async () => {
    expect(await withResponse({
      status: 'Success', LogID: 'fc80aafe', Message: 'Submitted Successfully',
    })).toEqual({ status: 'sent' });
  });

  it('still accepts the boolean shape other endpoints use', async () => {
    expect(await withResponse({ success: true })).toEqual({ status: 'sent' });
  });

  it('treats a failure status as failed', async () => {
    expect(await withResponse({
      status: 'failure', code: 446, desc: 'No template available',
    })).toEqual({ status: 'failed' });
  });

  it('treats an unrecognised body as failed rather than guessing', async () => {
    expect(await withResponse({ something: 'else' })).toEqual({ status: 'failed' });
  });
});

/**
 * The shape authkey.io actually posts, observed from a real guest reply.
 *
 * Nothing like the flat { messageId, from, content } I had inferred from
 * MSG91's docs: the message is nested two levels down under eventContent,
 * and the sender arrives with its country code attached.
 */
describe('authkey.io inbound', () => {
  const real = (text) => ({
    channel: 'wapp',
    appDetails: { type: 'wapp' },
    recipient: {},
    events: { eventType: 'message_inbox', timestamp: '1789972928', date: '2026-09-21 07:42' },
    eventContent: {
      message: {
        from: '919003143250',
        id: 'wamid.HBgMOTE5MDAzMTQzMjUwFQIAEhggQTRCM0Q2RTgxRjJBNEM5RDhF',
        text: { body: text },
        to: '918895231035',
        contentType: 'text',
        messageType: 'text',
        profileName: 'Prabakaran',
        name: 'Prabakaran',
      },
    },
    aCode: '91xxxxxxxxxxxx',
    media_url: '',
  });

  it('reads the message out of eventContent', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');
    const msg = normalizeInbound(real('4K7QP2 CAR'));

    expect(msg.id).toBe('wamid.HBgMOTE5MDAzMTQzMjUwFQIAEhggQTRCM0Q2RTgxRjJBNEM5RDhF');
    expect(msg.from).toBe('919003143250');
    expect(msg.text).toBe('4K7QP2 CAR');
  });

  it('copes if the text arrives as a bare string rather than { body }', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');
    const payload = real('x');
    payload.eventContent.message.text = 'DWR042';

    expect(normalizeInbound(payload).text).toBe('DWR042');
  });

  it('ignores a delivery report that carries no message', async () => {
    const { normalizeInbound } = await import('../lib/whatsapp.js');

    expect(normalizeInbound({
      channel: 'wapp',
      events: { eventType: 'message_status' },
      eventContent: { status: { id: 'wamid.x', status: 'delivered' } },
    })).toBeNull();
  });
});

/**
 * A media template carries an image header. authkey.io takes it as a URL it
 * fetches itself -- headerValues.headerData -- so the image has to be
 * publicly reachable, which is what /valet/t/<claim code> is for.
 */
describe('sending the timeline image with the message', () => {
  function capture(fn) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'Success' }) });
    vi.stubGlobal('fetch', fetchMock);
    return fn().then(() => JSON.parse(fetchMock.mock.calls[0][1].body));
  }

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.AUTHKEY_API_KEY = 'testkey';
  });

  it('attaches the image as a header when one is given', async () => {
    const body = await capture(() =>
      sendTemplate('919003143250', '49500', ['Palm Meadows', 'DWR-0011', 'https://dwaarai.com/valet/w/URK3DH'], {
        headerImageUrl: 'https://dwaarai.com/valet/t/URK3DH',
      }));

    expect(body.template_type).toBe('media');
    expect(body.headerValues.headerData).toBe('https://dwaarai.com/valet/t/URK3DH');
    expect(body.headerValues.headerFileName).toBeTruthy();
  });

  it('stays a plain text template when no image is given', async () => {
    const body = await capture(() => sendTemplate('919003143250', '49385', ['a', 'b', 'c']));

    // An approved text template must not start claiming to be a media one:
    // the header is part of what Meta approved, and the two are not
    // interchangeable.
    expect(body.template_type).toBeUndefined();
    expect(body.headerValues).toBeUndefined();
  });
});
