import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/whatsapp.js', () => ({
  isConfigured: vi.fn(() => true),
  sendText: vi.fn(async () => ({ status: 'sent' })),
  sendTemplate: vi.fn(async () => ({ status: 'sent' })),
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
