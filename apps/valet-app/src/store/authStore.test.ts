jest.mock('../api/valet');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  // Needed by queueCache.clearQueue. Without it that call throws into its own
  // catch and the test below passes whether or not the cache is ever cleared.
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('axios');

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useAuthStore } from './authStore';
import { REFRESH_KEY, TOKEN_KEY } from '../api/session';

const mockPost = axios.post as jest.Mock;
const mockSet = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: null, user: null, loading: false, restoring: false, error: null });
});

describe('signing in', () => {
  it('keeps the refresh token, not just the hour-long access token', async () => {
    mockPost.mockResolvedValue({
      data: { data: {
        token: 'access-1',
        refreshToken: 'refresh-1',
        user: { id: 'g1', name: 'Ramesh', communityName: 'Prestige Lakeside' },
      } },
    });

    await useAuthStore.getState().login('valet1', 'pw');

    expect(mockSet).toHaveBeenCalledWith(TOKEN_KEY, 'access-1');
    // Without this the session dies after an hour with no way back.
    expect(mockSet).toHaveBeenCalledWith(REFRESH_KEY, 'refresh-1');
  });
});

describe('a session that has run out', () => {
  it('drops the guard back to sign-in and says why', () => {
    useAuthStore.setState({ token: 'stale', user: { id: 'g1', name: 'Ramesh', communityName: null } });

    useAuthStore.getState().expireSession();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().sessionExpired).toBe(true);
  });
});

describe('what a shift change leaves behind', () => {
  const CACHE_KEY = 'dwaar_valet_queue_cache';

  it('clears the cached queue on sign-out', async () => {
    // The stand phone passes between attendants, and the cache holds plates
    // and guest names. Clearing the token while leaving the list behind would
    // hand the next person the last shift's guests.
    await useAuthStore.getState().logout();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(CACHE_KEY);
  });

  it('clears it when a session expires too, not only on a deliberate sign-out', async () => {
    useAuthStore.getState().expireSession();
    await new Promise((r) => setTimeout(r, 0));

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(CACHE_KEY);
  });
});
