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

export default api;
