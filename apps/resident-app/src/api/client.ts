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

// Auth — phone + OTP (existing login)
export const requestOTP = (phone: string) =>
  api.post('/auth/resident-otp', { phone });

export const verifyOTP = (phone: string, otp: string) =>
  api.post('/auth/resident-verify', { phone, otp });

// Auth — self-registration
export const registerResident = (data: {
  community_code: string;
  phone: string;
  unit_number: string;
}) => api.post('/auth/resident-register', data);

export const verifyRegistration = (phone: string, otp: string) =>
  api.post('/auth/resident-register-verify', { phone, otp });

// Vehicles
export const getVehicles = () => api.get('/vehicles');

export const createVehicle = (data: {
  plate: string;
  make: string;
  model: string;
  type: string;
}) => api.post('/vehicles', data);

export const updateVehicle = (
  id: string,
  data: { plate?: string; make?: string; model?: string; type?: string },
) => api.put(`/vehicles/${id}`, data);

export const deleteVehicle = (id: string) => api.delete(`/vehicles/${id}`);

// Passes
export const getPasses = () => api.get('/passes');

export const createPass = (data: {
  visitor_name: string;
  visitor_mobile?: string;
  visitor_vehicle?: string;
  valid_from: string;
  valid_until: string;
}) => api.post('/passes', data);

export const revokePass = (id: string) => api.delete(`/passes/${id}`);

// Events — resident unit events
export const getMyUnitEvents = (params?: Record<string, string>) =>
  api.get('/events/my-unit', { params });

// Notifications
export const registerFCMToken = (fcm_token: string) =>
  api.post('/notifications/register', { fcm_token });

export const unregisterFCMToken = () =>
  api.post('/notifications/unregister');

// Gate commands (for notification actions)
export const sendGateCommand = (gateId: string, action: string) =>
  api.post(`/gates/${gateId}/command`, { action });

export default api;
