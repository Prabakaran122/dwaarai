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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, pending, drain, clearOutbox, MAX_ATTEMPTS } from './outbox';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

const item = (over = {}) => ({
  kind: 'condition' as const,
  sessionToken: 'tok-1',
  uri: 'file://front.jpg',
  stage: 'intake',
  angle: 'front',
  ...over,
});

describe('holding work that could not be sent', () => {
  it('keeps what was queued, in the order it was queued', async () => {
    await enqueue(item({ angle: 'front' }));
    await enqueue(item({ angle: 'right' }));

    const q = await pending();
    expect(q.map((e) => e.payload.angle)).toEqual(['front', 'right']);
  });

  it('gives every entry an idempotency key, so a replay cannot duplicate it', async () => {
    // This is the whole reason the server grew Idempotency-Key. Without one
    // per entry, a reply lost on a flaky reconnect means the same photo is
    // uploaded twice and counted twice.
    await enqueue(item());
    const [entry] = await pending();
    // Shape is not the point -- uniqueness and a length the server will
    // accept are. The column is VARCHAR(64).
    expect(typeof entry.key).toBe('string');
    expect(entry.key.length).toBeGreaterThan(16);
    expect(entry.key.length).toBeLessThanOrEqual(64);
  });

  it('gives two entries different keys', async () => {
    await enqueue(item({ angle: 'front' }));
    await enqueue(item({ angle: 'back' }));
    const [a, b] = await pending();
    expect(a.key).not.toBe(b.key);
  });
});

describe('draining it when the server comes back', () => {
  it('sends each entry and removes the ones that succeed', async () => {
    await enqueue(item({ angle: 'front' }));
    await enqueue(item({ angle: 'back' }));
    const send = jest.fn().mockResolvedValue(undefined);

    const result = await drain(send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
    expect(await pending()).toHaveLength(0);
  });

  it('passes the key to the sender so the request can carry it', async () => {
    await enqueue(item());
    const send = jest.fn().mockResolvedValue(undefined);

    await drain(send);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ key: expect.any(String) }));
  });

  it('keeps an entry whose send failed, and counts the attempt', async () => {
    await enqueue(item());
    await drain(jest.fn().mockRejectedValue({ message: 'Network Error' }));

    const [entry] = await pending();
    expect(entry.attempts).toBe(1);
  });

  it('drops an entry the server will never accept, rather than retrying forever', async () => {
    // Mirrors the edge node: 400 and 422 mean these exact bytes are wrong, so
    // the same bytes will be wrong next time too.
    await enqueue(item());
    await drain(jest.fn().mockRejectedValue({ response: { status: 422 } }));

    expect(await pending()).toHaveLength(0);
  });

  it('gives up on an entry that has failed too many times', async () => {
    await enqueue(item());
    const failing = jest.fn().mockRejectedValue({ message: 'Network Error' });

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await drain(failing);

    // Otherwise one unsendable photo holds up every photo behind it, forever.
    expect(await pending()).toHaveLength(0);
  });

  it('stops draining the moment the network goes again', async () => {
    await enqueue(item({ angle: 'front' }));
    await enqueue(item({ angle: 'back' }));
    const send = jest.fn().mockRejectedValue({ message: 'Network Error' });

    await drain(send);

    // No point hammering four more uploads at a server that just refused to
    // answer -- and each one costs an attempt the entry cannot spare.
    expect(send).toHaveBeenCalledTimes(1);
    expect(await pending()).toHaveLength(2);
  });

  it('is safe to call when there is nothing queued', async () => {
    const send = jest.fn();
    const result = await drain(send);
    expect(result.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('what a shift change leaves behind', () => {
  it('clears on sign-out', async () => {
    await enqueue(item());
    await clearOutbox();
    expect(await pending()).toHaveLength(0);
  });
});

describe('captures that arrive while a drain is running', () => {
  it('are not overwritten when the drain writes back', async () => {
    // The drain now runs from the app root while photos are still being
    // taken. Writing back only its own snapshot deleted anything queued
    // during the upload.
    await enqueue(item({ angle: 'front' }));

    await drain(async () => {
      await enqueue(item({ angle: 'right' }));
    });

    expect((await pending()).map((e) => e.payload.angle)).toEqual(['right']);
  });
});

describe('entries the current session cannot send', () => {
  it('are kept untouched and charged no attempt', async () => {
    await enqueue(item({ community: 'other-venue' }));
    const send = jest.fn();

    const result = await drain(send, (e) => e.payload.community === 'other-venue');

    expect(send).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
    expect((await pending())[0].attempts).toBe(0);
  });
});

describe('a disk that will not take the write', () => {
  it('reports the enqueue as failed, so nobody is told the photo is safe', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('ENOSPC'));

    expect(await enqueue(item())).toBe(false);
  });
});
