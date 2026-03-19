import { create } from 'zustand';
import { setAuthToken } from '../api/client';

interface AuthUser {
  name: string;
  role: string;
  gateId: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true });
  },
  logout: () => set({ token: null, user: null, isAuthenticated: false }),
}));
