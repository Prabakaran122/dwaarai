import axios from 'axios';
import { z } from 'zod';

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({ baseURL: API_BASE, timeout: 10000 });

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.any().nullable(),
  meta: z.object({ ts: z.string(), requestId: z.string() }),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export function setAuthToken(token: string) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export function clearAuthToken() {
  delete api.defaults.headers.common['Authorization'];
}

export function setDeviceToken(token: string) {
  api.defaults.headers.common['X-Device-Token'] = token;
}

// Auth
export const login = (username: string, password: string) =>
  api.post('/auth/guard-login', { username, password });

// Gate operations
export const getGates = () => api.get('/gates');
export const getGateStatus = (id: string) => api.get(`/gates/${id}/status`);
export const sendGateCommand = (id: string, action: string) =>
  api.post(`/gates/${id}/command`, { action });

// Events
export const getEvents = (params?: Record<string, string>) =>
  api.get('/events', { params });

// Passes
export const verifyOTP = (otp: string, gateId: string) =>
  api.post('/passes/verify', { otp, gate_id: gateId });

// Incidents
export const createIncident = (data: {
  description: string;
  type: string;
  gateId: string;
}) => api.post('/incidents', data);

// FASTag — Register vehicle at gate (guard action)
export const registerVehicleAtGate = (data: {
  community_id: string;
  plate: string;
  unit_number: string;
  fastag_tid_hash?: string;
}) => api.post('/vehicles/register-at-gate', data);

// Notifications
export const notifyResident = (data: {
  visitor_name: string;
  unit_number: string;
  gate_id: string;
}) => api.post('/notifications/visitor-alert', data);

// 401 interceptor — auto-refresh token on expiry
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => response,
  async (err) => {
    const originalRequest = err.config;
    if (err.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/')) {
      originalRequest._retry = true;

      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const raw = await AsyncStorage.getItem('communitygate_guard_auth');
          if (raw) {
            const { refreshToken } = JSON.parse(raw);
            if (refreshToken) {
              const res = await api.post('/auth/refresh', { refreshToken });
              const { token: newToken, refreshToken: newRefresh } = res.data.data;
              setAuthToken(newToken);
              const stored = JSON.parse(raw);
              await AsyncStorage.setItem('communitygate_guard_auth', JSON.stringify({ ...stored, token: newToken, refreshToken: newRefresh }));
              onTokenRefreshed(newToken);
              isRefreshing = false;
              originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
              return api(originalRequest);
            }
          }
        } catch {
          isRefreshing = false;
        }
        isRefreshing = false;
      }

      return new Promise((resolve) => {
        refreshSubscribers.push((token) => {
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }
    return Promise.reject(err);
  }
);

export default api;
