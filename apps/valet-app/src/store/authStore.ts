import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { setValetAuthToken, clearValetAuthToken } from '../api/valet';

const TOKEN_KEY = 'sarthi_valet_token';
const USER_KEY = 'sarthi_valet_user';

/**
 * Sarthi signs valets in against the same api-gateway endpoint the guard app
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

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: false,
  restoring: true,
  error: null,

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
      await AsyncStorage.setItem(TOKEN_KEY, token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

      set({ token, user, loading: false });
      return true;
    } catch {
      set({ loading: false, error: 'loginFailed' });
      return false;
    }
  },

  logout: async () => {
    clearValetAuthToken();
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    set({ token: null, user: null });
  },

  // A valet stand's shift outlives the app being backgrounded, so a stored
  // token is restored rather than forcing a sign-in every time.
  restore: async () => {
    try {
      const [token, raw] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
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
