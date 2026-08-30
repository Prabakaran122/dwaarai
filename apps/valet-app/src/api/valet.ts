import axios from 'axios';

/**
 * Client for valet-service.
 *
 * A separate axios instance from api/client.ts because valet-service runs on
 * its own base URL, but it verifies the same api-gateway JWT — so
 * setValetAuthToken is called from the same place setAuthToken is, and a
 * guard's single sign-in covers both.
 */
const VALET_BASE =
  process.env.EXPO_PUBLIC_VALET_API_URL || 'https://dwaarai.com/valet-api';

const valet = axios.create({ baseURL: VALET_BASE, timeout: 15000 });

export function setValetAuthToken(token: string) {
  valet.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export function clearValetAuthToken() {
  delete valet.defaults.headers.common['Authorization'];
}

export type ValetStatus =
  | 'parked' | 'requested' | 'en_route' | 'arrived'
  | 'parked_again' | 'final_closed' | 'expired';

export interface ValetTicket {
  id: string;
  displayId: string;
  sessionToken: string;
  plate: string;
  vehicleMake: string;
  status: ValetStatus;
  stayEndAt: string;
  createdAt: string;
  closedAt: string | null;
  createdGuardName: string;
  currentGuardName: string | null;
  etaMinutes: number | null;
  enRouteStartedAt: string | null;
  disputed: boolean;
}

export interface CreatedTicket {
  id: string;
  displayId: string;
  sessionToken: string;
  guestUrl: string;
  qrDataUrl: string;
}

export interface PlateLookup {
  isReturning: boolean;
  visitCount?: number;
  lastVisitAt?: string;
}

export const listTickets = (all = false) =>
  valet.get<{ tickets: ValetTicket[] }>(`/guard/tickets${all ? '?all=true' : ''}`);

export const getTicket = (token: string) =>
  valet.get(`/guard/tickets/${token}`);

export const createTicket = (plate: string, vehicleMake: string, stayEndAt: string) =>
  valet.post<CreatedTicket>('/guard/tickets', { plate, vehicleMake, stayEndAt });

export const lookupPlate = (plate: string) =>
  valet.get<PlateLookup>(`/guard/plate-lookup?plate=${encodeURIComponent(plate)}`);

export const acceptTicket = (token: string, etaMinutes: number | null) =>
  valet.post(`/guard/tickets/${token}/accept`, etaMinutes ? { etaMinutes } : {});

export const markArrived = (token: string) =>
  valet.post(`/guard/tickets/${token}/arrived`);

export const scanPickup = (token: string, rotatingToken: string) =>
  valet.post(`/guard/tickets/${token}/scan`, { rotatingToken });

export const confirmPickup = (token: string, final: boolean) =>
  valet.post(`/guard/tickets/${token}/confirm-pickup`, { final });

export const expireTicket = (token: string) =>
  valet.post(`/guard/tickets/${token}/expire`);

/**
 * Multipart uploads. The guard's device may be on a weak connection at the
 * valet stand, so each capture is uploaded on its own: a dropped connection
 * costs one shot, never the whole set.
 */
export function uploadGuestPhoto(token: string, uri: string) {
  const form = new FormData();
  form.append('consentAck', 'true');
  form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  return valet.post(`/guard/tickets/${token}/photo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function uploadCondition(
  token: string,
  uri: string,
  stage: 'intake' | 'return',
  mediaType: 'photo' | 'video',
  angle?: 'front' | 'back' | 'left' | 'right'
) {
  const form = new FormData();
  // Order matters: the server reads these fields while streaming the
  // multipart body, so they must be appended before the file part.
  form.append('stage', stage);
  form.append('mediaType', mediaType);
  if (angle) form.append('angle', angle);
  form.append('media', {
    uri,
    name: mediaType === 'video' ? 'clip.mp4' : 'condition.jpg',
    type: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
  } as unknown as Blob);

  return valet.post(`/guard/tickets/${token}/condition`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export const guestPhotoUrl = (token: string) =>
  `${VALET_BASE}/guard/tickets/${token}/photo`;

export default valet;
