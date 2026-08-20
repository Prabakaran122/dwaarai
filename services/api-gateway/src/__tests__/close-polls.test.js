/**
 * close-polls.test.js — F-19 poll auto-close and result summary.
 *
 * queryRows call order inside closeDuePolls, per due poll:
 *   1. the due-poll list (once, up front)
 *   2. that poll's options with vote counts
 *   3. that community's fcm tokens
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/fcm.js', () => ({ sendToMultiple: vi.fn() }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const { query, queryRows } = await import('../db/queries.js');
const { sendToMultiple } = await import('../lib/fcm.js');
const { closeDuePolls, summaryText } = await import('../cron/close-polls.js');

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([]);
});

describe('summaryText', () => {
  it('F-19: names the leading option and its share', () => {
    const text = summaryText('Gym hours?', [
      { label: '6am', votes: 3 },
      { label: '7am', votes: 1 },
    ]);
    expect(text).toContain('6am');
    expect(text).toContain('75%');
  });

  it('F-19: says so plainly when nobody voted, rather than dividing by zero', () => {
    expect(summaryText('Gym hours?', [{ label: '6am', votes: 0 }])).toMatch(/no votes/i);
  });
});

describe('closeDuePolls', () => {
  it('F-19: closes a due poll and pushes one summary', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'p1', question: 'Gym hours?', community_id: 'c1' }])
      .mockResolvedValueOnce([{ label: '6am', votes: 2 }])
      .mockResolvedValueOnce([{ fcm_token: 'tok1' }]);

    expect(await closeDuePolls()).toBe(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'closed'"), ['p1']);
    expect(sendToMultiple).toHaveBeenCalledTimes(1);
  });

  it('F-19: does nothing when no poll is due', async () => {
    queryRows.mockResolvedValueOnce([]);
    expect(await closeDuePolls()).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(sendToMultiple).not.toHaveBeenCalled();
  });

  // The close is the product; the notification is a courtesy. If FCM is down
  // the poll must still end, or voting stays open indefinitely on an outage.
  it('F-19: still closes the poll when the summary push fails', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'p1', question: 'Gym hours?', community_id: 'c1' }])
      .mockResolvedValueOnce([{ label: '6am', votes: 2 }])
      .mockResolvedValueOnce([{ fcm_token: 'tok1' }]);
    sendToMultiple.mockRejectedValue(new Error('FCM down'));

    expect(await closeDuePolls()).toBe(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'closed'"), ['p1']);
  });

  it('F-19: skips the push when the community has no registered devices', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 'p1', question: 'Gym hours?', community_id: 'c1' }])
      .mockResolvedValueOnce([{ label: '6am', votes: 0 }])
      .mockResolvedValueOnce([]);

    expect(await closeDuePolls()).toBe(1);
    expect(sendToMultiple).not.toHaveBeenCalled();
  });
});
