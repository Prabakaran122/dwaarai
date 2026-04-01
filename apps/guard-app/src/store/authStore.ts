import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, clearAuthToken } from '../api/client';

const AUTH_STORAGE_KEY = 'communitygate_guard_auth';

interface AuthUser {
  name: string;
  role: string;
  gateId: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  rehydrate: () => Promise<void>;
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true });
    AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user })).catch(() => {});
  },

  logout: () => {
    clearAuthToken();
    set({ token: null, user: null, isAuthenticated: false });
    AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
  },

  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        if (token && !isTokenExpired(token)) {
          setAuthToken(token);
          set({ token, user, isAuthenticated: true, isLoading: false });
          return;
        }
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
    }
    set({ isLoading: false });
  },
}));
