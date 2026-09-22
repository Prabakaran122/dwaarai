import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/whatsapp.js', () => ({
  isConfigured: vi.fn(() => true),
  sendText: vi.fn(async () => ({ status: 'sent' })),
  sendTemplate: vi.fn(async () => ({ status: 'sent' })),
  // Mirrors the real one: free-form is available unless the provider is authkey.
  supportsFreeForm: vi.fn(() => (process.env.WHATSAPP_PROVIDER || '') !== 'authkey'),
}));

import { sendText, sendTemplate } from '../lib/whatsapp.js';
import { notifyGuest, WINDOW_MS } from '../lib/whatsapp-guest.js';

const ticket = (over = {}) => ({
  id: 't1',
  display_id: 'DWR-0042',
  plate: 'KA 03 NJ 0435',
  vehicle_make: 'Maruti Swift',
  community_name: 'The Leela',
  current_guard_name: 'Suresh',
  eta_minutes: 4,
  claim_code: '4K7QP2',
  phone_number: '919876543210',
  whatsapp_last_inbound_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('choosing free-form or template', () => {
  it('sends free-form inside the 24-hour window', async () => {
    await notifyGuest(ticket(), 'arrived');

    expect(sendText).toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('falls back to the template once the window has closed', async () => {
    const stale = new Date(Date.now() - WINDOW_MS - 60000).toISOString();

    await notifyGuest(ticket({ whatsapp_last_inbound_at: stale }), 'arrived');

    // Free-form outside the window is accepted by the API and never
    // delivered, so a guest on a multi-day stay would never hear their car
    // had arrived.
    expect(sendTemplate).toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('uses the template when the guest has never messaged us', async () => {
    await notifyGuest(ticket({ whatsapp_last_inbound_at: null }), 'arrived');

    expect(sendTemplate).toHaveBeenCalled();
  });

  it('sends nothing at all to a ticket with no number', async () => {
    expect(await notifyGuest(ticket({ phone_number: null }), 'arrived'))
      .toEqual({ status: 'skipped' });
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe('what the messages say', () => {
  it('confirms the binding with the vehicle and where to track it', async () => {
    await notifyGuest(ticket(), 'bound');

    const body = sendText.mock.calls[0][1];
    expect(body).toContain('KA 03 NJ 0435');
    expect(body).toContain('The Leela');
    expect(body).toContain('DWR-0042');
    // Every message that needs the guest to act ends in a link back, because
    // the rotating pickup QR cannot be delivered over WhatsApp.
    expect(body).toContain('/valet/');
  });

  it('carries the ETA and the valet name when the car is on its way', async () => {
    await notifyGuest(ticket(), 'en_route');

    const body = sendText.mock.calls[0][1];
    expect(body).toContain('4');
    expect(body).toContain('Suresh');
  });

  it('never puts the session token in a message', async () => {
    await notifyGuest(ticket({ session_token: 'a'.repeat(32) }), 'bound');

    expect(sendText.mock.calls[0][1]).not.toContain('a'.repeat(32));
  });
});

describe('when free-form is not available on the provider', () => {
  it('falls back to the template rather than leaving the guest unnotified', async () => {
    vi.mocked(sendText).mockResolvedValueOnce({ status: 'failed' });

    const ticket = {
      phone_number: '919876543210',
      whatsapp_last_inbound_at: new Date().toISOString(),
      community_name: 'The Leela',
      display_id: 'DWR-0042',
      claim_code: '4K7QP2',
    };

    const res = await notifyGuest(ticket, 'arrived');

    // authkey.io publishes no free-form path. If the attempt is rejected the
    // guest must still hear that their car is at the door -- a template always
    // delivers, and hearing it slightly less naturally beats not hearing it.
    expect(sendText).toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalled();
    expect(res.status).toBe('sent');
  });

  it('does not send twice when the free-form message worked', async () => {
    vi.mocked(sendText).mockResolvedValueOnce({ status: 'sent' });

    await notifyGuest({
      phone_number: '919876543210',
      whatsapp_last_inbound_at: new Date().toISOString(),
      community_name: 'The Leela',
      claim_code: '4K7QP2',
    }, 'arrived');

    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('does not fall back when the send was merely skipped', async () => {
    vi.mocked(sendText).mockResolvedValueOnce({ status: 'skipped' });

    await notifyGuest({
      phone_number: '919876543210',
      whatsapp_last_inbound_at: new Date().toISOString(),
      community_name: 'The Leela',
      claim_code: '4K7QP2',
    }, 'arrived');

    // Skipped means nothing is configured. Retrying as a template would just
    // be a second skip, and would read in the logs as a real attempt.
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe('on a provider with no free-form messages', () => {
  const ticket = (extra = {}) => ({
    phone_number: '919003143250',
    whatsapp_last_inbound_at: new Date().toISOString(),
    community_name: 'Palm Meadows',
    display_id: 'DWR-0009',
    claim_code: 'B73V5M',
    plate: 'TN09AB1234',
    vehicle_make: 'Toyota Innova',
    ...extra,
  });

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.WHATSAPP_TEMPLATE_CAR_READY = '49385';
    process.env.WHATSAPP_TEMPLATE_CHECKED_IN = '49411';
    delete process.env.WHATSAPP_TEMPLATE_ON_THE_WAY;
  });

  it('tells a guest their car is checked in, not that it is ready', async () => {
    await notifyGuest(ticket(), 'bound');

    // authkey.io has no free-form path at all, so every message is a template
    // and there is exactly one per thing worth saying. With a single template
    // the fallback told a guest whose car had just been parked that it was
    // ready for collection.
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledWith('919003143250', '49411', expect.anything(), expect.anything());
  });

  it('uses the ready template when the car has actually arrived', async () => {
    await notifyGuest(ticket({ status: 'arrived' }), 'arrived');
    expect(sendTemplate).toHaveBeenCalledWith('919003143250', '49385', expect.anything(), expect.anything());
  });

  it('says nothing rather than something untrue when no template fits', async () => {
    const res = await notifyGuest(ticket(), 'accepted');

    // No on-the-way template configured. Saying "ready for collection" to a
    // guest whose car is still being fetched sends them to the kerb for a car
    // that is not there -- worse than silence, and the tracking link they
    // already have is live.
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(res.status).toBe('skipped');
  });

  it('still sends free-form on a provider that supports it', async () => {
    process.env.WHATSAPP_PROVIDER = 'msg91';
    await notifyGuest(ticket(), 'bound');
    expect(sendText).toHaveBeenCalled();
  });
});

describe('the stages a guest is told about', () => {
  const ticket = () => ({
    phone_number: '919003143250',
    community_name: 'Palm Meadows',
    display_id: 'DWR-0010',
    claim_code: 'B73V5M',
    plate: 'TN09XY5678',
    vehicle_make: 'Honda City',
  });

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.WHATSAPP_TEMPLATE_CHECKED_IN = '49411';
    process.env.WHATSAPP_TEMPLATE_REQUESTED = '49443';
    process.env.WHATSAPP_TEMPLATE_ON_THE_WAY = '49442';
    process.env.WHATSAPP_TEMPLATE_CAR_READY = '49385';
  });

  // Each stage is a different fact about where the car is, and a guest
  // deciding when to walk to the kerb needs them apart: "we have your
  // request" and "your car is moving" are minutes and a decision apart.
  it.each([
    ['bound', '49411'],
    ['accepted', '49443'],
    ['en_route', '49442'],
    ['arrived', '49385'],
  ])('tells a guest about %s with its own template', async (kind, wid) => {
    await notifyGuest(ticket(), kind);
    expect(sendTemplate).toHaveBeenCalledWith('919003143250', wid, expect.anything(), expect.anything());
  });

  it('does not reuse the on-the-way wording for a request just received', async () => {
    await notifyGuest(ticket(), 'accepted');
    expect(sendTemplate).not.toHaveBeenCalledWith('919003143250', '49442', expect.anything(), expect.anything());
  });
});

describe('the picture that goes with the message', () => {
  const ticket = () => ({
    phone_number: '919003143250', community_name: 'Palm Meadows',
    display_id: 'DWR-0011', claim_code: 'URK3DH',
    plate: 'KA01ME9999', vehicle_make: 'BMW 5 Series',
  });

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'authkey';
    process.env.WHATSAPP_TEMPLATE_CAR_READY = '49385';
    process.env.VALET_GUEST_BASE_URL = 'https://dwaarai.com/valet';
    delete process.env.WHATSAPP_TEMPLATE_MEDIA;
  });

  it('sends the timeline image when the template is a media one', async () => {
    process.env.WHATSAPP_TEMPLATE_MEDIA = '1';

    await notifyGuest(ticket(), 'arrived');

    // Rendered per request, so a message sent now shows where the car is now.
    // Addressed by claim code like every other guest link.
    expect(sendTemplate).toHaveBeenCalledWith(
      '919003143250', '49385', expect.anything(),
      expect.objectContaining({ headerImageUrl: 'https://dwaarai.com/valet/t/URK3DH' })
    );
  });

  it('sends no header while the approved templates are still text', async () => {
    await notifyGuest(ticket(), 'arrived');

    const opts = vi.mocked(sendTemplate).mock.calls[0][3];
    // Declaring media against a text-approved template would have the
    // provider reject every send, which is worse than a plain message.
    expect(opts?.headerImageUrl).toBeUndefined();
  });
});
