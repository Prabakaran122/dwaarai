import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendClaimCode } from '../lib/sms.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.MSG91_AUTH_KEY = 'test-key';
  process.env.MSG91_SENDER_ID = 'DWAARA';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const ticket = {
  phoneNumber: '9876543210',
  claimCode: '4K7QP2',
  claimUrl: 'https://dwaarai.com/valet',
  venueName: 'Prestige Lakeside',
};

describe('texting the guest their claim code', () => {
  it('sends the code and the link, so a guest who will not tap a link can still type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendClaimCode(ticket)).toEqual({ status: 'sent' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toContain('4K7QP2');
    expect(body.message).toContain('https://dwaarai.com/valet');
    expect(body.mobiles).toBe('919876543210');
  });

  it('reports skipped rather than pretending, when MSG91 is not configured', async () => {
    delete process.env.MSG91_AUTH_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // The silent no-op is the trap this avoids: a guard told "sent" for a text
    // that never left, on a guest who has now walked away.
    expect(await sendClaimCode(ticket)).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when MSG91 fails — the car is already taken in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    expect(await sendClaimCode(ticket)).toEqual({ status: 'failed' });
  });

  it('reports failed when MSG91 answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ type: 'error', message: 'template not registered' }),
    }));

    expect(await sendClaimCode(ticket)).toEqual({ status: 'failed' });
  });
});
