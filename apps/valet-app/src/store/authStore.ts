import { clearQueue } from '../lib/queueCache';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { setValetAuthToken, clearValetAuthToken } from '../api/valet';
import {
  USER_KEY, saveTokens, clearSession, setSessionExpiredHandler, loadAccessToken,
  type SessionEndReason,
} from '../api/session';

/**
 * DwaarAI Valet signs valets in against the same api-gateway endpoint the guard app
 * uses (`/auth/guard-login`, `residents.type = 'guard'`), because valet-service
 * verifies exactly those tokens. It is a separate app, not a separate identity
 * system — a property's staff exist once.
 */
const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.com/api/v1';

export interface ValetUser {
  id: string;
  name: string;
  communityName: string | null;
}

interface AuthState {
  token: string | null;
  user: ValetUser | null;
  loading: boolean;
  restoring: boolean;
  error: string | null;
  /** The hour ran out and the refresh token could not save it either. */
  sessionExpired: boolean;
  /** A manager turned this person's access off (401 staff_inactive). */
  staffInactive: boolean;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  expireSession: (reason?: SessionEndReason) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: false,
  restoring: true,
  error: null,
  sessionExpired: false,
  staffInactive: false,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await axios.post(`${API_BASE}/auth/guard-login`, { username, password });
      const data = res.data?.data || res.data;
      const token: string = data.token || data.accessToken;
      if (!token) throw new Error('no token in response');

      const user: ValetUser = {
        id: data.user?.id || data.id,
        name: data.user?.name || username,
        communityName: data.user?.communityName ?? null,
      };

      setValetAuthToken(token);
      // The refresh token is the whole point: the access token above is good
      // for an hour, and a valet's shift is not.
      await saveTokens(token, data.refreshToken);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

      set({ token, user, loading: false, sessionExpired: false, staffInactive: false });
      return true;
    } catch (err) {
      // A deactivated account is not a typo. "Login failed" sends them round
      // the password again; this tells them who can actually fix it.
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      set({ loading: false, error: code === 'staff_inactive' ? 'valetStaffInactive' : 'loginFailed' });
      return false;
    }
  },

  logout: async () => {
    clearValetAuthToken();
    await clearSession();
    // The cached queue carries plates and guest names, and a stand phone
    // passes between attendants at every shift change. Dropping the token
    // while leaving the list behind hands the next person this shift's guests.
    await clearQueue();
    // The condition-photo outbox is deliberately NOT cleared. Those photos are
    // evidence for cars already on the lot, and a shift ending in the basement
    // is exactly when some are still waiting for signal; deleting them here
    // used to lose them for good. They carry their ticket token and upload
    // under whichever staff session of the same venue signs in next -- the
    // upload endpoint asks for nothing more -- and the app-level sync
    // (lib/outboxSync) sends them as soon as one exists.
    set({ token: null, user: null, sessionExpired: false, staffInactive: false });
  },

  // Reached from the API layer when a 401 could not be refreshed away. Storage
  // is already cleared by then; this is what moves the app off the screen the
  // valet is stuck on and tells them what to do about it.
  expireSession: (reason = 'expired') => {
    clearValetAuthToken();
    // Same reasoning as logout, queue and outbox alike. An expired session is
    // still the end of that attendant's access, and it is the more common of
    // the two.
    void clearQueue();
    set({
      token: null, user: null,
      sessionExpired: reason === 'expired',
      staffInactive: reason === 'inactive',
    });
  },

  // A valet stand's shift outlives the app being backgrounded, so a stored
  // token is restored rather than forcing a sign-in every time.
  restore: async () => {
    try {
      const [token, raw] = await Promise.all([
        loadAccessToken(),
        AsyncStorage.getItem(USER_KEY),
      ]);
      if (token) {
        setValetAuthToken(token);
        set({ token, user: raw ? JSON.parse(raw) : null });
      }
    } catch {
      /* first run, or unreadable storage — fall through to the login screen */
    } finally {
      set({ restoring: false });
    }
  },
}));

// Wired here rather than in the API module so session.ts stays free of any
// import back into the store.
setSessionExpiredHandler((reason) => useAuthStore.getState().expireSession(reason));
