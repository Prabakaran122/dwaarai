import axios from 'axios';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://dwaarai.in/api/v1';

const SERVER_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');
export function uploadUrl(p?: string | null): string | null {
  if (!p) return null;
  return /^https?:\/\//.test(p) ? p : `${SERVER_ORIGIN}${p}`;
}

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

export const refreshAuthToken = (refreshToken: string) =>
  api.post('/auth/refresh', { refreshToken });

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

// Approvals
export const respondToApproval = (id: string, action: 'approve' | 'deny') =>
  api.post(`/approvals/${id}/respond`, { action });

// Recurring passes
export const getRecurringPasses = () => api.get('/recurring-passes');

export const createRecurringPass = (data: {
  visitor_name: string;
  visitor_role?: string;
  schedule_type: string;
  schedule_days?: number[];
  time_from: string;
  time_until: string;
}) => api.post('/recurring-passes', data);

export const updateRecurringPass = (id: string, data: Record<string, any>) =>
  api.put(`/recurring-passes/${id}`, data);

export const cancelRecurringPass = (id: string) =>
  api.delete(`/recurring-passes/${id}`);

// Household / family members
export const getMembers = () => api.get('/members');

export const createMember = (data: {
  name: string;
  mobile: string;
  relationship?: string;
  notify_on_approval?: boolean;
}) => api.post('/members', data);

export const updateMember = (
  id: string,
  data: { name?: string; relationship?: string; notify_on_approval?: boolean },
) => api.put(`/members/${id}`, data);

export const deleteMember = (id: string) => api.delete(`/members/${id}`);

// Community notice board
export const getNotices = () => api.get('/notices');

export const getNotice = (id: string) => api.get(`/notices/${id}`);

export const createNotice = (data: { title: string; body: string }) =>
  api.post('/notices', data);

export const replyToNotice = (id: string, body: string) =>
  api.post(`/notices/${id}/replies`, { body });

export const deleteNotice = (id: string) => api.delete(`/notices/${id}`);

// Maintenance dues
export const getDues = () => api.get('/dues');

export const getDuesHistory = () => api.get('/dues/history');

export const payDue = (id: string) => api.post(`/dues/${id}/pay`);

export const getPaymentStatus = (paymentId: string) =>
  api.get(`/dues/payments/${paymentId}`);

export function dueReceiptUrl(paymentId: string) {
  return `${API_BASE}/dues/payments/${paymentId}/receipt`;
}

// Resident home (aggregate dashboard)
export const getResidentHome = () => api.get('/resident/home');

// Resident unit (My Unit aggregate)
export const getResidentUnit = () => api.get('/resident/unit');

// Deliveries (parcels) — resident
export const getDeliveries = (params?: Record<string, string>) =>
  api.get('/deliveries', { params });

export const collectDelivery = (id: string) => api.post(`/deliveries/${id}/collect`);

// Pets (My Unit)
export const getPets = () => api.get('/pets');
export const createPet = (data: { name: string; species: string; breed?: string; notes?: string }) => api.post('/pets', data);
export const deletePet = (id: string) => api.delete(`/pets/${id}`);

// Face identity & consent
export const getFaceIdentity = () => api.get('/face');

export const enrollFace = (data: {
  consent_acknowledged: boolean;
  consent_locations?: string[];
  scan_b64?: string;
}) => api.post('/face/enroll', data);

export const setFaceConsent = (location: string, enabled: boolean) =>
  api.put('/face/consent', { location, enabled });

export const deleteFaceData = () => api.delete('/face');

export const getFaceAccessLog = () => api.get('/face/access-log');

// Face identity & consent — household members (owner enrols on their behalf,
// scoped server-side to residents of the same unit)
export const getMemberFace = (id: string) => api.get(`/members/${id}/face`);
export const enrollMemberFace = (id: string, vector: number[]) =>
  api.post(`/members/${id}/face/enroll`, { vector });
// NOTE: the server's PUT /members/:id/face/consent mirrors the self-scoped
// PUT /face/consent — it toggles ONE { location, enabled } pair per call
// (see services/api-gateway/src/routes/face.js's shared consentSchema), not
// a bulk `consents` array as an earlier draft of this client assumed.
export const setMemberFaceConsent = (id: string, location: string, enabled: boolean) =>
  api.put(`/members/${id}/face/consent`, { location, enabled });
export const deleteMemberFace = (id: string) => api.delete(`/members/${id}/face`);

// Unit documents (vault)
export const getDocuments = () => api.get('/documents');
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);
export const uploadDocument = (form: FormData) =>
  api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });

// Facility booking (My Unit)
export const getFacilities = () => api.get('/facilities');
export const getFacilityAvailability = (id: string, date: string) => api.get(`/facilities/${id}/availability`, { params: { date } });
export const bookFacility = (id: string, data: { date: string; start: string }) => api.post(`/facilities/${id}/book`, data);
export const getMyBookings = () => api.get('/facilities/mine');
export const cancelBooking = (id: string) => api.delete(`/facilities/bookings/${id}`);

// Events
export const getEvents = (scope: 'upcoming' | 'past' = 'upcoming') => api.get('/community-events', { params: { scope } });
export const createEvent = (data: { title: string; description?: string; location?: string; category?: string; startsAt: string; endsAt?: string }) => api.post('/community-events', data);
export const rsvpEvent = (id: string, status: 'going' | 'maybe' | 'no') => api.post(`/community-events/${id}/rsvp`, { status });

// Community
export const getCommunityFeed = () => api.get('/community/feed');
export const getIssues = () => api.get('/issues');
export const createIssue = (data: { title: string; body: string; category?: string }) => api.post('/issues', data);
export const upvoteIssue = (id: string) => api.post(`/issues/${id}/upvote`);
export const getPolls = () => api.get('/polls');
export const votePoll = (id: string, optionId: string) => api.post(`/polls/${id}/vote`, { optionId });
export const closePoll = (id: string) => api.post(`/polls/${id}/close`);
export const getBlocks = () => api.get('/blocks');

export type PostType = 'announcement' | 'issue' | 'poll' | 'discussion';
export type PollAudience = 'all' | 'owners' | 'block';

export interface CreatePollBody {
  topic?: string;
  question: string;
  options: string[];
  closesAt?: string;
  audience?: PollAudience;
  targetBlockId?: string | null;
  oneVotePerUnit?: boolean;
  isAnonymous?: boolean;
  showLiveResults?: boolean;
}

export const getIssue = (id: string) => api.get(`/issues/${id}`);

export const replyToIssue = (id: string, body: string) =>
  api.post(`/issues/${id}/replies`, { body });

export const changeIssueStatus = (id: string, status: string, assigneeName?: string) =>
  api.put(`/issues/${id}/status`, assigneeName ? { status, assignee_name: assigneeName } : { status });

// The server's multer field is `photos` and it caps the request at 5 files
// (MAX_ISSUE_PHOTOS in services/api-gateway/src/routes/issues.js).
// The server's fileFilter trusts the declared mimetype, so declaring
// image/jpeg for everything would let a HEIC original — which is what arrives
// when compression falls back to the untouched file — land on disk as a .jpg.
// Derive it from the uri instead. Compressed photos are genuinely JPEG and
// fall through to the default.
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

function describePhoto(uri: string, index: number) {
  const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const type = MIME_BY_EXT[ext] ?? 'image/jpeg';
  const suffix = ext && MIME_BY_EXT[ext] ? ext : 'jpg';
  return { uri, name: `photo-${index}.${suffix}`, type };
}

export const uploadIssuePhotos = (id: string, uris: string[]) => {
  const form = new FormData();
  uris.forEach((uri, i) => {
    form.append('photos', describePhoto(uri, i) as unknown as Blob);
  });
  return api.post(`/issues/${id}/photos`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const createAnnouncement = (data: { title: string; body: string; priority?: 'normal' | 'urgent' }) =>
  api.post('/notices', { ...data, category: 'official' });

export const createDiscussion = (data: { title: string; body: string }) =>
  api.post('/notices', { ...data, category: 'discussion' });

export const createPoll = (data: CreatePollBody) => api.post('/polls', data);

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
          const raw = await AsyncStorage.getItem('communitygate_resident_auth');
          if (raw) {
            const { refreshToken } = JSON.parse(raw);
            if (refreshToken) {
              const res = await api.post('/auth/refresh', { refreshToken });
              const { token: newToken, refreshToken: newRefresh } = res.data.data;
              setAuthToken(newToken);
              const stored = JSON.parse(raw);
              await AsyncStorage.setItem('communitygate_resident_auth', JSON.stringify({ ...stored, token: newToken, refreshToken: newRefresh }));
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
