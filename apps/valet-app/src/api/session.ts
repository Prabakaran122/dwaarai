import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { getToken, setToken, deleteTokens } from '../lib/tokenStore';

/**
 * The valet's session, and how it survives an hour.
 *
 * api-gateway issues an access token good for one hour and a refresh token
 * good for a week. DwaarAI Valet originally kept only the first: an hour into a
 * shift every call started returning 401, and because nothing handled it the
 * valet saw "That action failed, try again" on a car they were holding keys
 * for -- forever, since the dead token was restored again on every app start.
 *
 * Kept out of the axios module and out of the store so both can use it without
 * importing each other.
 */

export const TOKEN_KEY = 'dwaar_valet_token';
export const REFRESH_KEY = 'dwaar_valet_refresh';
export const USER_KEY = 'dwaar_valet_user';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.com/api/v1';

/**
 * Why a session ended, for the sign-in screen to say.
 *
 * 'inactive' is a manager having switched this person off. Telling them their
 * "session ended" sends them straight back to sign in, fail, and conclude the
 * app is broken; the message they need is who to talk to.
 */
export type SessionEndReason = 'expired' | 'inactive';

/** Called when the refresh token is gone too and only signing in will help. */
let onSessionExpired: ((reason: SessionEndReason) => void) | null = null;

export function setSessionExpiredHandler(handler: ((reason: SessionEndReason) => void) | null) {
  onSessionExpired = handler;
}

/** The access token, from secure storage (migrating a pre-0.9 copy if needed). */
export function loadAccessToken(): Promise<string | null> {
  return getToken(TOKEN_KEY);
}

export async function saveTokens(token: string, refreshToken?: string | null) {
  await setToken(TOKEN_KEY, token);
  if (refreshToken) await setToken(REFRESH_KEY, refreshToken);
}

export async function clearSession() {
  await deleteTokens([TOKEN_KEY, REFRESH_KEY]);
  await AsyncStorage.multiRemove([USER_KEY]);
}

/** The server switched this staff member off. Never worth a refresh. */
export function isStaffInactive(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error?: string } } };
  return e?.response?.status === 401 && e.response.data?.error === 'staff_inactive';
}

export type RefreshOutcome =
  | { kind: 'ok'; token: string }
  /** The server said no, definitively. Only signing in again will help. */
  | { kind: 'rejected'; reason: SessionEndReason }
  /** Could not find out: no signal, a timeout, a 5xx. Try again later. */
  | { kind: 'unavailable' };

/**
 * Trades the stored refresh token for a new access token, and says what
 * happened when it could not.
 *
 * Only a 401/403 from the refresh call ends the session. Every failure used to
 * clear it -- so walking into the basement with the access token an hour old
 * meant one dropped request, a deleted refresh token, and a sign-in plus face
 * check for an attendant who was holding somebody's keys. A refresh that never
 * got an answer has learned nothing about the token, and keeping it costs
 * nothing: the next request simply tries again.
 */
export async function refreshSession(): Promise<RefreshOutcome> {
  const refreshToken = await getToken(REFRESH_KEY);
  // Nothing to refresh with is as definitive as a rejection.
  if (!refreshToken) return { kind: 'rejected', reason: 'expired' };

  let res;
  try {
    res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) {
      await clearSession();
      return { kind: 'rejected', reason: isStaffInactive(err) ? 'inactive' : 'expired' };
    }
    return { kind: 'unavailable' };
  }

  const data = res.data?.data || res.data;
  const token: string | undefined = data?.token || data?.accessToken;
  // A 200 with no token is the server misbehaving, not a verdict on ours.
  if (!token) return { kind: 'unavailable' };

  // The server rotates the refresh token. Dropping the new one would leave
  // the next refresh presenting a token the server has already retired.
  await saveTokens(token, data?.refreshToken);
  return { kind: 'ok', token };
}

/** The new access token, or null when there is none to be had right now. */
export async function refreshAccessToken(): Promise<string | null> {
  const outcome = await refreshSession();
  return outcome.kind === 'ok' ? outcome.token : null;
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
  response?: { status?: number; data?: { error?: string } };
  config?: { url?: string; _retry?: boolean; headers?: Record<string, string> };
}): Promise<AuthRetry> {
  const config = err.config;
  if (err.response?.status !== 401 || !config) return { retry: false };

  // Deactivated staff: a fresh token would be refused the same way, and the
  // person holding the phone needs to be told, not silently retried.
  if (isStaffInactive(err)) {
    await clearSession();
    onSessionExpired?.('inactive');
    return { retry: false };
  }

  if (config._retry) return { retry: false };
  // A 401 from the sign-in or refresh call itself is a credentials problem,
  // not an expiry one, and refreshing against it would recurse.
  if (config.url?.includes('/auth/')) return { retry: false };

  config._retry = true;

  const outcome = await refreshSession();
  if (outcome.kind === 'ok') return { retry: true, token: outcome.token };
  if (outcome.kind === 'rejected') {
    await clearSession();
    onSessionExpired?.(outcome.reason);
  }
  // 'unavailable': this request fails like any other offline request, and
  // the session survives for the next one to refresh.
  return { retry: false };
}
