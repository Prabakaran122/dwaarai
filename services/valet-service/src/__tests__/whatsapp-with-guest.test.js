import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/whatsapp.js', () => ({
  isConfigured: vi.fn(() => true),
  sendText: vi.fn(async () => ({ status: 'sent' })),
  sendTemplate: vi.fn(async () => ({ status: 'sent' })),
  supportsFreeForm: vi.fn(() => true),
}));

import { sendText } from '../lib/whatsapp.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import { statusKind } from '../routes/webhooks.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_NOTIFY_STAGES = 'bound,accepted,with_guest';
});

// A guest who has their car and messages CAR was told "your car is with us.
// Reply CAR when you want it brought round" -- the 'bound' welcome, because
// every status the webhook did not recognise fell through to it.
describe('a guest who has their car', () => {
  it('is answered as having it, not as having parked it', () => {
    expect(statusKind('with_guest')).toBe('with_guest');
  });

  it('is told how to bring it back, not to reply CAR', async () => {
    await notifyGuest({
      id: 't1', display_id: 'DWR-0001', plate: 'KA05MN4321', vehicle_make: 'Honda City',
      community_name: 'Palm Meadows', phone_number: '919876500001',
      whatsapp_last_inbound_at: new Date().toISOString(), claim_code: 'WK6UG2',
    }, 'with_guest');

    const text = sendText.mock.calls[0][1];
    expect(text).toContain('KA05MN4321');
    expect(text).toMatch(/with you/i);
    expect(text).not.toMatch(/reply car/i);
  });
});
