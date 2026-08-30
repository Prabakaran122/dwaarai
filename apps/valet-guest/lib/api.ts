/**
 * Guest-side client for valet-service.
 *
 * There is no token, no login and no stored session here by design: the guest
 * scanned a physical card, and the session token in the URL is the only
 * credential. Nothing is written to localStorage, so reopening the link on a
 * different phone reconstructs the same state and closing the tab loses
 * nothing.
 */

export const VALET_BASE =
  process.env.NEXT_PUBLIC_VALET_API_URL || 'http://localhost:3060';

export type ValetStatus =
  | 'parked' | 'requested' | 'en_route' | 'arrived'
  | 'parked_again' | 'final_closed' | 'expired';

export interface GuestTicket {
  displayId: string;
  plate: string;
  vehicleMake: string;
  venueName: string;
  status: ValetStatus;
  elapsedMinutes: number;
  guardName: string | null;
  etaSeconds: number | null;
  dropOffGuardName: string;
}

export interface RotatingQr {
  qrDataUrl: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface GuardBadge {
  name: string;
  employeeCode: string;
  hasPhoto: boolean;
}

/** Thrown for any non-2xx, carrying the service's machine-readable code. */
export class GuestError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${VALET_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });

  if (!res.ok) {
    let code = 'error';
    let message = 'Something went wrong.';
    try {
      const body = await res.json();
      code = body?.error || code;
      message = body?.message || message;
    } catch {
      /* keep the defaults */
    }
    throw new GuestError(res.status, code, message);
  }
  return res.json();
}

export const getTicket = (token: string) =>
  call<GuestTicket>(`/guest/tickets/${token}`);

export const requestCar = (token: string) =>
  call<GuestTicket>(`/guest/tickets/${token}/request`, { method: 'POST', body: '{}' });

export const getRotatingQr = (token: string) =>
  call<RotatingQr>(`/guest/tickets/${token}/rotating-qr`);

export const getBadge = (token: string, which: 'dropoff' | 'current') =>
  call<GuardBadge>(`/guest/tickets/${token}/guard-badge/${which}`);

export const badgePhotoUrl = (token: string, which: 'dropoff' | 'current') =>
  `${VALET_BASE}/guest/tickets/${token}/guard-badge/${which}/photo`;

export const claimDiscount = (token: string, phoneNumber: string) =>
  call<{ code: string; expiry: string }>(`/guest/tickets/${token}/discount-optin`, {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  });

/** Mirrors the server's validation so the guest sees the problem before a round trip. */
export function isValidIndianMobile(raw: string): boolean {
  return /^(\+91)?[6-9]\d{9}$/.test(raw.replace(/\s+/g, ''));
}

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
