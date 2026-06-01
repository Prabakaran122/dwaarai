import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, clearAuthToken } from '../api/client';
import { connectSocket, disconnectSocket } from '../api/socket';

const AUTH_STORAGE_KEY = 'communitygate_guard_auth';

interface AuthUser {
  name: string;
  role: string;
  gateId: string;
  language?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: AuthUser, refreshToken?: string) => void;
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
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,

  login: (token, user, refreshToken) => {
    setAuthToken(token);
    connectSocket(token);
    set({ token, user, refreshToken: refreshToken || null, isAuthenticated: true });
    AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user, refreshToken })).catch(() => {});
  },

  logout: () => {
    clearAuthToken();
    disconnectSocket();
    set({ token: null, user: null, isAuthenticated: false });
    AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
  },

  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const { token, user, refreshToken } = JSON.parse(raw);
        if (token && !isTokenExpired(token)) {
          setAuthToken(token);
          connectSocket(token);
          set({ token, user, refreshToken, isAuthenticated: true, isLoading: false });
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
