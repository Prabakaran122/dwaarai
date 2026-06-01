import axios from 'axios';
import { z } from 'zod';

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.in/api/v1';

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

// Persist the guard's preferred UI language
export const setGuardLanguage = (language: 'en' | 'hi' | 'kn') =>
  api.put('/guard/language', { language });

// SOS / emergency
export const raiseSos = (type: string, note?: string) =>
  api.post('/sos', { type, note });
export const getActiveSos = () => api.get('/sos/active');
export const resolveSos = (id: string) => api.post(`/sos/${id}/resolve`);

// Deliveries
export const logDelivery = (unit_number: string, company: string, note?: string) =>
  api.post('/deliveries', { unit_number, company, note });
export const getActiveDeliveries = () => api.get('/deliveries/active');
export const updateDeliveryStatus = (id: string, status: 'delivered' | 'left_at_gate') =>
  api.post(`/deliveries/${id}/status`, { status });

// Shift handover
export const postHandover = (note: string) => api.post('/handover', { note });
export const getLatestHandover = () => api.get('/handover/latest');

// Driver facial verification
export const verifyDriver = (data: { unit_number?: string; plate?: string; scan_b64: string }) =>
  api.post('/face/verify-driver', data);

// Daily staff roster
export const getStaff = () => api.get('/staff');
export const checkinStaff = (passId: string) => api.post(`/staff/${passId}/checkin`);

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

// Approvals
export const createApproval = (data: {
  unit_number: string;
  visitor_name: string;
  vehicle_plate?: string;
  gate_id: string;
}) => api.post('/approvals', data);

export const getApproval = (id: string) => api.get(`/approvals/${id}`);

// Expected visits (recurring visitors)
export const getExpectedVisits = (date?: string) =>
  api.get('/expected-visits', { params: date ? { date } : undefined });

export const markVisitArrived = (id: string, photo?: FormData) => {
  if (photo) {
    return api.post(`/expected-visits/${id}/arrived`, photo, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
  return api.post(`/expected-visits/${id}/arrived`);
};

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
