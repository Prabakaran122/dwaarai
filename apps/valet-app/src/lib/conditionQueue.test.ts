jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
      clear: jest.fn(async () => { store = {}; }),
    },
  };
});
jest.mock('../api/valet');

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../api/valet';
import { uploadOrQueue, flushConditionQueue } from './conditionQueue';
import { pending } from './outbox';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

const netFail = { message: 'Network Error' };

describe('capturing condition media with no signal', () => {
  it('uploads straight away when the server is there', async () => {
    (api.uploadCondition as jest.Mock).mockResolvedValue({});

    const res = await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    expect(res.queued).toBe(false);
    expect(await pending()).toHaveLength(0);
  });

  it('queues instead of failing when the upload cannot reach the server', async () => {
    // The photo is the evidence. Losing it because a basement has no signal
    // is the exact failure this whole exercise exists to stop.
    (api.uploadCondition as jest.Mock).mockRejectedValue(netFail);

    const res = await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    expect(res.queued).toBe(true);
    const q = await pending();
    expect(q).toHaveLength(1);
    expect(q[0].payload).toMatchObject({ uri: 'file://a.jpg', angle: 'front' });
  });

  it('does NOT queue when the server actively rejected it', async () => {
    // A 422 means these bytes are wrong. Queueing them would retry the same
    // rejection three times and then drop it, having told the attendant it
    // was safely captured.
    (api.uploadCondition as jest.Mock).mockRejectedValue({ response: { status: 422 } });

    const res = await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    expect(res.queued).toBe(false);
    expect(res.ok).toBe(false);
    expect(await pending()).toHaveLength(0);
  });

  it('reports a queued capture as captured, because it is', async () => {
    (api.uploadCondition as jest.Mock).mockRejectedValue(netFail);
    const res = await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');
    // The attendant took the photo. Telling them it failed would have them
    // retake it, which queues a second copy of the same angle.
    expect(res.ok).toBe(true);
  });
});

describe('flushing when the server comes back', () => {
  it('sends what was queued, carrying the idempotency key', async () => {
    (api.uploadCondition as jest.Mock).mockRejectedValueOnce(netFail);
    await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    (api.uploadCondition as jest.Mock).mockResolvedValue({});
    const result = await flushConditionQueue();

    expect(result.sent).toBe(1);
    const call = (api.uploadCondition as jest.Mock).mock.calls.at(-1);
    // token, uri, stage, mediaType, angle, key
    expect(typeof call[5]).toBe('string');
    expect(call[5].length).toBeGreaterThan(16);
    expect(await pending()).toHaveLength(0);
  });

  it('leaves the queue alone when the server is still unreachable', async () => {
    (api.uploadCondition as jest.Mock).mockRejectedValue(netFail);
    await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    await flushConditionQueue();

    expect(await pending()).toHaveLength(1);
  });
});

describe('a capture that could not be kept either', () => {
  it('is reported as not captured, so the attendant retakes it', async () => {
    (api.uploadCondition as jest.Mock).mockRejectedValue(netFail);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('ENOSPC'));

    const res = await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    expect(res.ok).toBe(false);
  });
});

describe('photos queued at another venue', () => {
  it('wait for a session of their own venue instead of being 404ed away', async () => {
    (api.currentCommunityId as jest.Mock).mockReturnValue('venue-a');
    (api.uploadCondition as jest.Mock).mockRejectedValueOnce(netFail);
    await uploadOrQueue('tok-1', 'file://a.jpg', 'intake', 'photo', 'front');

    // The stand phone is now signed into a different property.
    (api.currentCommunityId as jest.Mock).mockReturnValue('venue-b');
    (api.uploadCondition as jest.Mock).mockResolvedValue({});
    await flushConditionQueue();

    expect(api.uploadCondition).toHaveBeenCalledTimes(1); // only the first, failed attempt
    expect(await pending()).toHaveLength(1);

    (api.currentCommunityId as jest.Mock).mockReturnValue('venue-a');
    const result = await flushConditionQueue();
    expect(result.sent).toBe(1);
  });
});
