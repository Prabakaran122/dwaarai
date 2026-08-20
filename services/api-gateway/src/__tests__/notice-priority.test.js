/**
 * notice-priority.test.js — F-21 announcement tiers and F-22 pinned cap.
 *
 * The delivery rules are exercised as pure functions rather than through the
 * route, because the interesting behaviour is the matrix itself: which tier
 * pushes how, and which one is allowed to spend money on SMS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/fcm.js', () => ({ sendToMultiple: vi.fn() }));
vi.mock('../lib/msg91.js', () => ({
  sendTransactionalSMS: vi.fn(),
  isConfigured: vi.fn(() => true),
}));

const { query, queryRows } = await import('../db/queries.js');
const { sendToMultiple } = await import('../lib/fcm.js');
const { sendTransactionalSMS } = await import('../lib/msg91.js');
const {
  NOTICE_PRIORITIES, normalisePriority, deliveryFor, publishNotice, MAX_PINNED,
} = await import('../routes/notices.js');

const notice = (over = {}) => ({
  id: 'n1', community_id: 'c1', title: 'Water cut', body: 'From 9am', priority: 'normal', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ANNOUNCEMENT_SMS_ENABLED;
  query.mockResolvedValue([]);
  queryRows.mockResolvedValue([{ fcm_token: 'ExponentPushToken[abc]', phone: '9876543210' }]);
});

describe('priority vocabulary', () => {
  it("F-21: maps the BRD's 'general' onto the stored 'normal'", () => {
    expect(normalisePriority('general')).toBe('normal');
  });

  // The installed Basera build sends these two and reads them back.
  it('F-21: leaves the installed vocabulary untouched', () => {
    expect(normalisePriority('normal')).toBe('normal');
    expect(normalisePriority('urgent')).toBe('urgent');
    expect(NOTICE_PRIORITIES).toContain('normal');
    expect(NOTICE_PRIORITIES).toContain('urgent');
  });

  it('F-21: defaults a missing priority to normal', () => {
    expect(normalisePriority(undefined)).toBe('normal');
  });
});

describe('deliveryFor', () => {
  // Approved deviation: the BRD gives General no push at all. Keeping push
  // would make General and Important identical, so they split on treatment.
  it('F-21: General pushes, but quietly', () => {
    expect(deliveryFor('normal')).toEqual({ push: 'default', sound: null, sms: false });
  });

  it('F-21: Important pushes with sound and never texts', () => {
    expect(deliveryFor('important')).toEqual({ push: 'high', sound: 'default', sms: false });
  });

  it('F-21: only Urgent asks for SMS', () => {
    expect(deliveryFor('urgent')).toEqual({ push: 'high', sound: 'default', sms: true });
  });
});

describe('publishNotice', () => {
  it('F-21: sends a General announcement silently', async () => {
    await publishNotice(notice({ priority: 'normal' }));
    expect(sendToMultiple).toHaveBeenCalledWith(
      expect.any(Array), expect.any(String), expect.any(String), expect.any(Object),
      { priority: 'default', sound: null }
    );
  });

  it('F-21: sends no SMS while ANNOUNCEMENT_SMS_ENABLED is off', async () => {
    await publishNotice(notice({ priority: 'urgent' }));
    expect(sendTransactionalSMS).not.toHaveBeenCalled();
  });

  it('F-21: sends SMS for Urgent once the flag is on', async () => {
    process.env.ANNOUNCEMENT_SMS_ENABLED = 'true';
    await publishNotice(notice({ priority: 'urgent' }));
    expect(sendTransactionalSMS).toHaveBeenCalledTimes(1);
  });

  it('F-21: never texts for Important, however loud the flag', async () => {
    process.env.ANNOUNCEMENT_SMS_ENABLED = 'true';
    await publishNotice(notice({ priority: 'important' }));
    expect(sendTransactionalSMS).not.toHaveBeenCalled();
  });

  // The announcement is the product; delivery is a courtesy. Neither a dead
  // MSG91 nor a dead FCM may turn a published notice into an error.
  it('F-21: survives an SMS failure', async () => {
    process.env.ANNOUNCEMENT_SMS_ENABLED = 'true';
    sendTransactionalSMS.mockRejectedValue(new Error('MSG91 down'));
    await expect(publishNotice(notice({ priority: 'urgent' }))).resolves.toBeUndefined();
  });

  it('F-21: survives a push failure', async () => {
    sendToMultiple.mockRejectedValue(new Error('FCM down'));
    await expect(publishNotice(notice())).resolves.toBeUndefined();
  });
});

describe('pinned cap', () => {
  it('F-22: caps the pinned stack at three', () => {
    expect(MAX_PINNED).toBe(3);
  });
});
