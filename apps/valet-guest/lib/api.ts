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
  | 'requested' | 'accepted' | 'parking_in_progress'
  | 'parked' | 'retrieval_requested' | 'en_route' | 'arrived'
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
  /**
   * The guard has scanned the guest's pickup QR for this arrival — the car is
   * theirs. Confirming pickup happens minutes later, after the guard has
   * photographed the car, by which point the guest has driven off.
   */
  handedOver: boolean;
  /** The venue uploaded a logo. Where it lives stays on our side of the wire. */
  hasVenueLogo: boolean;
  /** A printed card is in the guest's hand and should be handed back. */
  hasCard: boolean;
  /** The venue's own promo, when it has advertising. Null decides the slot. */
  promo: { label: string; link: string | null } | null;
  /** Seconds left to collect before the car is flagged. Null unless arrived. */
  collectBySeconds: number | null;
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

/** Addressed by session token, like the guard badge photo — no ids cross. */
export const venueLogoUrl = (token: string) =>
  `${VALET_BASE}/guest/tickets/${token}/venue-logo`;

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

export type FeedbackReason = 'wrong_vehicle' | 'long_wait' | 'damage' | 'staff_conduct';

export const REASON_LABEL: Record<FeedbackReason, string> = {
  wrong_vehicle: 'Wrong vehicle',
  long_wait: 'Long wait',
  damage: 'Damage',
  staff_conduct: 'Staff conduct',
};

export const submitFeedback = (
  token: string, satisfied: boolean, reasons: FeedbackReason[] = []
) =>
  call<{ recorded: boolean }>(`/guest/tickets/${token}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ satisfied, reasons }),
  });
