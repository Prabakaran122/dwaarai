jest.mock('./conditionQueue', () => ({ flushConditionQueue: jest.fn() }));

import { startOutboxSync, OUTBOX_SYNC_MS } from './outboxSync';
import { flushConditionQueue } from './conditionQueue';
import { reachability } from './connectivity';

/**
 * The outbox used to drain only while the queue screen was mounted, so photos
 * taken on intake or handover waited until somebody went back to the list.
 */
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (flushConditionQueue as jest.Mock).mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 });
  reachability.getState().reset();
});

afterEach(() => jest.useRealTimers());

describe('draining the outbox from the app root', () => {
  it('flushes at once, for whatever an earlier session left behind', () => {
    const stop = startOutboxSync();
    expect(flushConditionQueue).toHaveBeenCalledTimes(1);
    stop();
  });

  it('flushes the moment the server answers again', () => {
    const stop = startOutboxSync();
    reachability.getState().noteFailure({ message: 'Network Error' });
    reachability.getState().noteSuccess();

    expect(flushConditionQueue).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps trying on a timer, and stops when the session ends', () => {
    const stop = startOutboxSync();
    jest.advanceTimersByTime(OUTBOX_SYNC_MS);
    expect(flushConditionQueue).toHaveBeenCalledTimes(2);

    stop();
    jest.advanceTimersByTime(OUTBOX_SYNC_MS * 3);
    expect(flushConditionQueue).toHaveBeenCalledTimes(2);
  });
});
