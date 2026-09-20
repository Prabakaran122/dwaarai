import axios from 'axios';
import { resolveAuthRetry } from './session';

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

/**
 * An expired access token retries itself once, silently.
 *
 * Without this a valet's hour ran out mid-shift and every screen reported a
 * generic failure they could do nothing about -- on a car whose keys they were
 * already holding. Mirrors the guard app's interceptor; the decision itself
 * lives in session.ts so it can be tested without an HTTP layer.
 *
 * Called from the app entry rather than registered on import: several suites
 * automock axios, which makes axios.create() return undefined, and a
 * module-level registration would then throw before any test ran.
 */
export function installAuthRefresh() {
  valet.interceptors.response.use(
    (res) => res,
    async (err) => {
      const decision = await resolveAuthRetry(err);
      if (!decision.retry) return Promise.reject(err);

      setValetAuthToken(decision.token);
      err.config.headers = {
        ...(err.config.headers || {}),
        Authorization: `Bearer ${decision.token}`,
      };
      return valet(err.config);
    }
  );
}

export type ValetStatus =
  | 'requested' | 'accepted' | 'parking_in_progress'
  | 'parked' | 'retrieval_requested' | 'en_route' | 'arrived'
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
  /** The printed card bound to this ticket, or null for a screen-QR ticket. */
  cardCode: string | null;
  /** Short code the guest can type at /valet later. */
  claimCode: string | null;
  /**
   * Where the car is, when the venue uses slots.
   *
   * Optional rather than required: the server always sends it, but an app
   * build that predates slots should keep working rather than fail to parse a
   * queue over a field it never reads.
   */
  slot?: { floor: string; zone: string; number: string } | null;
}

export interface CreatedTicket {
  id: string;
  displayId: string;
  sessionToken: string;
  guestUrl: string;
  /** Null when no printed card was scanned — the screen QR is then the ticket. */
  cardCode: string | null;
  /** Short code the guest can type at /valet later. Issued for every ticket. */
  claimCode: string | null;
  /** Where they type it. From the server, never guessed from the API base. */
  claimUrl?: string;
  /**
   * Whether the code actually reached the guest's phone. Null when no number
   * was given. Never assumed: a guard told "sent" for a message that never
   * left would not read the code out, and the guest is already walking away.
   */
  smsStatus?: 'sent' | 'skipped' | 'failed' | null;
  qrDataUrl: string;
}

export interface PlateLookup {
  isReturning: boolean;
  visitCount?: number;
  lastVisitAt?: string;
}

export const listTickets = (all = false) =>
  valet.get<{ tickets: ValetTicket[] }>(`/guard/tickets${all ? '?all=true' : ''}`);

export interface TicketDetail extends ValetTicket {
  /** Whether a guest comparison photo was captured at intake. */
  hasPhoto: boolean;
  events: Array<{
    event_type: string;
    guard_name: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export const getTicket = (token: string) =>
  valet.get<TicketDetail>(`/guard/tickets/${token}`);

export interface TicketExtras {
  cardCode?: string;
  phoneNumber?: string;
  slotId?: string;
  guestName?: string;
  carType?: 'hatchback' | 'sedan' | 'suv';
  isPremium?: boolean;
}

/**
 * Extras arrive as an object rather than more positional arguments. Six
 * optionals in a row is a call nobody can read and everybody mis-orders.
 */
/**
 * Starts a job the moment the card is scanned, before the details exist.
 *
 * The ticket now lives from this point, which is what lets a guest who scans
 * the same card seconds later find something to attach themselves to.
 */
/** Takes a job the desk logged, before anyone else walks to the same car. */
export const acceptIntake = (token: string) =>
  valet.post<ValetTicket>(`/guard/tickets/${token}/accept-intake`);

export const startIntake = (cardCode?: string) =>
  valet.post<CreatedTicket>('/guard/tickets/start', { cardCode });

export const completeIntake = (
  token: string, plate: string, vehicleMake: string, stayEndAt: string,
  extras: Omit<TicketExtras, 'cardCode'> = {}
) =>
  valet.post<ValetTicket>(`/guard/tickets/${token}/complete`, {
    plate, vehicleMake, stayEndAt, ...extras,
  });

export const createTicket = (
  plate: string, vehicleMake: string, stayEndAt: string, extras: TicketExtras = {}
) =>
  valet.post<CreatedTicket>('/guard/tickets', { plate, vehicleMake, stayEndAt, ...extras });

export interface SlotZone { zone: string; slots: { id: string; number: string }[] }
export interface SlotFloor { floor: string; zones: SlotZone[] }

/**
 * Free slots, grouped floor then zone.
 *
 * `enabled: false` is not an empty garage — it means this venue does not use
 * slots at all, and the step is hidden rather than shown with nothing in it.
 */
export const listSlots = () =>
  valet.get<{ enabled: boolean; floors: SlotFloor[] }>('/guard/slots');

/** Searches beyond the open queue — a closed ticket, or a queue too big to hold. */
export const searchTickets = (plate: string) =>
  valet.get<{ query: string; tickets: ValetTicket[] }>(
    `/guard/tickets/search?plate=${encodeURIComponent(plate)}`
  );

/** Binds a printed card to a ticket that already exists. */
export const bindCard = (token: string, cardCode: string) =>
  valet.post(`/guard/tickets/${token}/card`, { cardCode });

export const lookupPlate = (plate: string) =>
  valet.get<PlateLookup>(`/guard/plate-lookup?plate=${encodeURIComponent(plate)}`);

export const acceptTicket = (token: string, etaMinutes: number | null) =>
  valet.post(`/guard/tickets/${token}/accept`, etaMinutes ? { etaMinutes } : {});

export const markArrived = (token: string) =>
  valet.post(`/guard/tickets/${token}/arrived`);

export const scanPickup = (token: string, rotatingToken: string) =>
  valet.post(`/guard/tickets/${token}/scan`, { rotatingToken });

/**
 * How the guard established the person is the right one.
 *
 * 'photo' means they compared the intake photo; 'vehicle_confirmed' means no
 * photo existed and the guest identified the vehicle instead. The server
 * refuses a 'photo' claim on a ticket carrying no photo, so this cannot be
 * used to manufacture a check that never happened.
 */
export type Verification = 'photo' | 'vehicle_confirmed';

export const confirmPickup = (token: string, final: boolean, verification: Verification) =>
  valet.post(`/guard/tickets/${token}/confirm-pickup`, { final, verification });

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

/**
 * The intake photo, as an image source the guard app can actually render.
 *
 * The plain URL was handed straight to <Image source={{uri}}>, which sends no
 * Authorization header — and this endpoint requires a guard token, so it
 * answered 401 and rendered an empty frame. For every ticket, photo or not:
 * the guard was asked to compare a face against nothing.
 *
 * React Native's Image honours a headers map on a network source, so the
 * native loader keeps the caching and memory handling rather than pulling a
 * multi-megabyte photo through JS as base64. Whether a photo exists at all is
 * a separate question, answered by the ticket's hasPhoto — never by waiting
 * for this to fail.
 */
export const guestPhotoSource = (token: string) => ({
  uri: `${VALET_BASE}/guard/tickets/${token}/photo`,
  headers: {
    Authorization: valet.defaults.headers.common['Authorization'] as string,
  },
});

export default valet;
