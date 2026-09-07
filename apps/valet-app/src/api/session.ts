import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

/**
 * The valet's session, and how it survives an hour.
 *
 * api-gateway issues an access token good for one hour and a refresh token
 * good for a week. Sarthi originally kept only the first: an hour into a
 * shift every call started returning 401, and because nothing handled it the
 * valet saw "That action failed, try again" on a car they were holding keys
 * for -- forever, since the dead token was restored again on every app start.
 *
 * Kept out of the axios module and out of the store so both can use it without
 * importing each other.
 */

export const TOKEN_KEY = 'sarthi_valet_token';
export const REFRESH_KEY = 'sarthi_valet_refresh';
export const USER_KEY = 'sarthi_valet_user';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.com/api/v1';

/** Called when the refresh token is gone too and only signing in will help. */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

export async function saveTokens(token: string, refreshToken?: string | null) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) await AsyncStorage.setItem(REFRESH_KEY, refreshToken);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]);
}

/**
 * Trades the stored refresh token for a new access token.
 *
 * Returns null for every failure -- no refresh token, a rejected one, an
 * unreachable server -- because the caller's decision is the same in all three
 * cases: this request cannot be retried.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  try {
    const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
    const data = res.data?.data || res.data;
    const token: string | undefined = data?.token || data?.accessToken;
    if (!token) throw new Error('no token in refresh response');

    // The server rotates the refresh token. Dropping the new one would leave
    // the next refresh presenting a token the server has already retired.
    await saveTokens(token, data?.refreshToken);
    return token;
  } catch {
    await clearSession();
    return null;
  }
}

type AuthRetry = { retry: true; token: string } | { retry: false };

/**
 * Whether a failed request should be tried again with a fresh token.
 *
 * Marks the request as retried so a second 401 -- the refreshed token being
 * rejected as well -- ends the attempt rather than looping a valet stand
 * against the server.
 */
export async function resolveAuthRetry(err: {
  response?: { status?: number };
  config?: { url?: string; _retry?: boolean; headers?: Record<string, string> };
}): Promise<AuthRetry> {
  const config = err.config;
  if (err.response?.status !== 401 || !config || config._retry) return { retry: false };
  // A 401 from the sign-in or refresh call itself is a credentials problem,
  // not an expiry one, and refreshing against it would recurse.
  if (config.url?.includes('/auth/')) return { retry: false };

  config._retry = true;

  const token = await refreshAccessToken();
  if (!token) {
    onSessionExpired?.();
    return { retry: false };
  }
  return { retry: true, token };
}
