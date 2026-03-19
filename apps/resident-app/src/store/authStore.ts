import { create } from 'zustand';
import { setAuthToken } from '../api/client';

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  unitNumber: string;
}

type OTPStep = 'phone' | 'otp';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  otpStep: OTPStep;
  phone: string;
  setPhone: (phone: string) => void;
  setOtpStep: (step: OTPStep) => void;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  otpStep: 'phone',
  phone: '',
  setPhone: (phone) => set({ phone }),
  setOtpStep: (otpStep) => set({ otpStep }),
  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true, otpStep: 'phone' });
  },
  logout: () =>
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      otpStep: 'phone',
      phone: '',
    }),
}));
