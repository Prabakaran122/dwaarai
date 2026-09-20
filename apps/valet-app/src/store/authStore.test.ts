jest.mock('../api/valet');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
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
