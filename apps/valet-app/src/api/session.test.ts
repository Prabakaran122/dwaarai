jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('axios');

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {
  refreshAccessToken,
  resolveAuthRetry,
  setSessionExpiredHandler,
  REFRESH_KEY,
  TOKEN_KEY,
} from './session';

const mockGet = AsyncStorage.getItem as jest.Mock;
const mockSet = AsyncStorage.setItem as jest.Mock;
const mockPost = axios.post as jest.Mock;

function storedRefresh(value: string | null) {
  mockGet.mockImplementation(async (key: string) => (key === REFRESH_KEY ? value : null));
}

beforeEach(() => {
  jest.clearAllMocks();
  setSessionExpiredHandler(null);
  mockGet.mockResolvedValue(null);
});

describe('refreshing an expired access token', () => {
  it('swaps the rejected token for a fresh pair', async () => {
    storedRefresh('refresh-abc');
    mockPost.mockResolvedValue({ data: { data: { token: 'new-access', refreshToken: 'new-refresh' } } });

    const token = await refreshAccessToken();

    expect(token).toBe('new-access');
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      { refreshToken: 'refresh-abc' }
    );
    // The rotated refresh token has to be kept, or the next hour fails the
    // same way with a token the server has already retired.
    expect(mockSet).toHaveBeenCalledWith(TOKEN_KEY, 'new-access');
    expect(mockSet).toHaveBeenCalledWith(REFRESH_KEY, 'new-refresh');
  });

  it('never calls the server when no refresh token was ever stored', async () => {
    storedRefresh(null);

    expect(await refreshAccessToken()).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('gives up and clears the session when the refresh token is itself expired', async () => {
    storedRefresh('refresh-abc');
    mockPost.mockRejectedValue(new Error('401'));

    expect(await refreshAccessToken()).toBeNull();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });
});

describe('deciding whether a failed request can be retried', () => {
  const unauthorized = () => ({ response: { status: 401 }, config: { url: '/guard/tickets', headers: {} } });

  it('retries a 401 once, with the refreshed token', async () => {
    storedRefresh('refresh-abc');
    mockPost.mockResolvedValue({ data: { data: { token: 'new-access', refreshToken: 'r2' } } });

    expect(await resolveAuthRetry(unauthorized())).toEqual({ retry: true, token: 'new-access' });
  });

  it('does not retry a request that has already been retried', async () => {
    storedRefresh('refresh-abc');
    mockPost.mockResolvedValue({ data: { data: { token: 'new-access', refreshToken: 'r2' } } });
    const err = unauthorized();

    await resolveAuthRetry(err);
    // A second 401 on the same request means the fresh token was rejected too.
    // Retrying again is an infinite loop against a valet's own stand.
    expect(await resolveAuthRetry(err)).toEqual({ retry: false });
  });

  it('leaves anything that is not a 401 alone', async () => {
    const err = { response: { status: 500 }, config: { url: '/guard/tickets', headers: {} } };

    expect(await resolveAuthRetry(err)).toEqual({ retry: false });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('tells the app the session is over when the refresh fails', async () => {
    storedRefresh('refresh-abc');
    mockPost.mockRejectedValue(new Error('401'));
    const expired = jest.fn();
    setSessionExpiredHandler(expired);

    expect(await resolveAuthRetry(unauthorized())).toEqual({ retry: false });
    expect(expired).toHaveBeenCalled();
  });
});
