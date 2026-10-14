// Same in-memory stand-in the session tests use: the real module needs a
// native bridge that does not exist under Jest.
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
import { saveQueue, loadQueue, clearQueue } from './queueCache';

const ticket = (over = {}) => ({
  id: 't1', displayId: 'DWR-0001', plate: 'KA03NJ0435', vehicleMake: 'Swift',
  status: 'parked', createdAt: '2026-09-25T10:00:00Z', ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('the queue an attendant sees with no signal', () => {
  it('gives back what was last seen, and when', async () => {
    await saveQueue([ticket()] as never);

    const cached = await loadQueue();

    expect(cached?.tickets).toHaveLength(1);
    expect(cached?.tickets[0].displayId).toBe('DWR-0001');
    expect(typeof cached?.savedAt).toBe('number');
  });

  it('returns null when nothing was ever cached, rather than an empty queue', async () => {
    // An empty list reads as "no cars on the lot", which on a busy evening is
    // a lie an attendant would act on. Null lets the screen say "no data yet".
    expect(await loadQueue()).toBeNull();
  });

  it('survives a corrupted entry instead of crashing the screen', async () => {
    await AsyncStorage.setItem('dwaar_valet_queue_cache', '{not json');
    expect(await loadQueue()).toBeNull();
  });

  it('replaces the previous snapshot rather than accumulating', async () => {
    await saveQueue([ticket({ id: 'a' })] as never);
    await saveQueue([ticket({ id: 'b' })] as never);

    const cached = await loadQueue();
    expect(cached?.tickets).toHaveLength(1);
    expect(cached?.tickets[0].id).toBe('b');
  });

  it('clears on sign-out, so the next attendant sees nothing of this shift', async () => {
    // The queue names guests and plates. It must not outlive the session that
    // fetched it on a shared stand phone.
    await saveQueue([ticket()] as never);
    await clearQueue();
    expect(await loadQueue()).toBeNull();
  });

  it('never lets a storage failure break the caller', async () => {
    // Caching is a convenience. A full disk must not be able to stop a valet
    // taking a car in.
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveQueue([ticket()] as never)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
