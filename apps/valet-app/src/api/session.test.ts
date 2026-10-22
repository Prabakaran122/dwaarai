jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('axios');

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import {
  refreshAccessToken,
  resolveAuthRetry,
  setSessionExpiredHandler,
  loadAccessToken,
  REFRESH_KEY,
  TOKEN_KEY,
} from './session';

const mockGet = AsyncStorage.getItem as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;
const mockPost = axios.post as jest.Mock;

async function storedRefresh(value: string | null) {
  if (value) await SecureStore.setItemAsync(REFRESH_KEY, value);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
  mockSet.mockClear();
}

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as unknown as { __reset: () => void }).__reset();
  setSessionExpiredHandler(null);
  mockGet.mockResolvedValue(null);
});

describe('refreshing an expired access token', () => {
  it('swaps the rejected token for a fresh pair', async () => {
    await storedRefresh('refresh-abc');
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
    await storedRefresh(null);

    expect(await refreshAccessToken()).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('gives up and clears the session when the refresh token is itself expired', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockRejectedValue({ response: { status: 401 } });

    expect(await refreshAccessToken()).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
  });

  it('keeps the session through a network blip, so the next request can refresh', async () => {
    // Walking into a basement with an hour-old token used to delete the
    // refresh token on one dropped request -- a sign-in and a face check for
    // somebody holding a guest's keys.
    await storedRefresh('refresh-abc');
    mockPost.mockRejectedValue({ message: 'Network Error' });

    expect(await refreshAccessToken()).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe('refresh-abc');
  });

  it('keeps the session through a server error on the refresh', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockRejectedValue({ response: { status: 502 } });

    expect(await refreshAccessToken()).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe('refresh-abc');
  });
});

describe('where the tokens are kept', () => {
  it('writes them to secure storage, never to AsyncStorage', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockResolvedValue({ data: { data: { token: 'new-access', refreshToken: 'new-refresh' } } });

    await refreshAccessToken();

    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(REFRESH_KEY, expect.anything());
  });

  it('moves a token an older build left in AsyncStorage, and deletes the plaintext copy', async () => {
    mockGet.mockImplementation(async (k: string) => (k === TOKEN_KEY ? 'legacy-access' : null));

    expect(await loadAccessToken()).toBe('legacy-access');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBe('legacy-access');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
  });
});

describe('deciding whether a failed request can be retried', () => {
  const unauthorized = () => ({ response: { status: 401 }, config: { url: '/guard/tickets', headers: {} } });

  it('retries a 401 once, with the refreshed token', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockResolvedValue({ data: { data: { token: 'new-access', refreshToken: 'r2' } } });

    expect(await resolveAuthRetry(unauthorized())).toEqual({ retry: true, token: 'new-access' });
  });

  it('does not retry a request that has already been retried', async () => {
    await storedRefresh('refresh-abc');
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

  it('tells the app the session is over when the refresh is rejected', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockRejectedValue({ response: { status: 401 } });
    const expired = jest.fn();
    setSessionExpiredHandler(expired);

    expect(await resolveAuthRetry(unauthorized())).toEqual({ retry: false });
    expect(expired).toHaveBeenCalledWith('expired');
  });

  it('does not end the session when the refresh merely could not be reached', async () => {
    await storedRefresh('refresh-abc');
    mockPost.mockRejectedValue({ message: 'Network Error' });
    const expired = jest.fn();
    setSessionExpiredHandler(expired);

    expect(await resolveAuthRetry(unauthorized())).toEqual({ retry: false });
    expect(expired).not.toHaveBeenCalled();
  });

  it('signs a deactivated staff member out without trying to refresh', async () => {
    await storedRefresh('refresh-abc');
    const ended = jest.fn();
    setSessionExpiredHandler(ended);
    const err = {
      response: { status: 401, data: { error: 'staff_inactive' } },
      config: { url: '/guard/tickets', headers: {} },
    };

    expect(await resolveAuthRetry(err)).toEqual({ retry: false });
    expect(mockPost).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledWith('inactive');
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
  });
});
