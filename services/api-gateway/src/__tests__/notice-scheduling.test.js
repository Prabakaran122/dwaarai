/**
 * notice-scheduling.test.js — F-24 scheduled announcements, F-25 replies toggle.
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
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const { query, queryRows } = await import('../db/queries.js');
const { sendToMultiple } = await import('../lib/fcm.js');
const { releaseDueNotices } = await import('../cron/publish-notices.js');

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([]);
});

describe('releaseDueNotices', () => {
  it('F-24: releases a due announcement and notifies once', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', community_id: 'c1', title: 'Water cut', body: 'From 9am', priority: 'important' }])
      .mockResolvedValueOnce([{ fcm_token: 'ExponentPushToken[abc]' }]);

    expect(await releaseDueNotices()).toBe(1);
    expect(sendToMultiple).toHaveBeenCalledTimes(1);
  });

  it('F-24: does nothing when nothing is due', async () => {
    queryRows.mockResolvedValueOnce([]);
    expect(await releaseDueNotices()).toBe(0);
    expect(sendToMultiple).not.toHaveBeenCalled();
  });

  // Clearing scheduled_at is the claim. The UPDATE ... RETURNING only matches
  // rows still carrying one, so a second pass finds nothing and nobody is
  // notified twice about the same announcement.
  it('F-24: claims rows in the same statement that releases them', async () => {
    queryRows.mockResolvedValueOnce([]);
    await releaseDueNotices();
    expect(queryRows).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE notices[\s\S]*scheduled_at = NULL[\s\S]*RETURNING/)
    );
  });

  it('F-24: a delivery failure still leaves the announcement published', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', community_id: 'c1', title: 't', body: 'b', priority: 'normal' }])
      .mockResolvedValueOnce([{ fcm_token: 'ExponentPushToken[abc]' }]);
    sendToMultiple.mockRejectedValue(new Error('FCM down'));

    await expect(releaseDueNotices()).resolves.toBe(1);
  });

  it('F-22: releasing a scheduled announcement also trims the pinned stack', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', community_id: 'c1', title: 't', body: 'b', priority: 'normal' }])
      .mockResolvedValueOnce([]);

    await releaseDueNotices();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('is_pinned = false'), ['c1']);
  });
});
