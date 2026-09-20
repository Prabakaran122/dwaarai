/**
 * Client for valet-service.
 *
 * Separate from lib/api.ts because valet-service is its own service on its own
 * base URL, but it accepts the same api-gateway JWT, so the credentials come
 * from exactly the same place. Keeping one token source means a session that
 * expires logs the operator out of both consistently.
 */

const VALET_BASE = process.env.NEXT_PUBLIC_VALET_API_URL || 'http://localhost:3060';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('cg_admin_token') || '';
}

function getCommunityId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cg_selected_community_id');
}

export class ValetError extends Error {
  /** The service's machine-readable code, e.g. 'scan_required'. */
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ValetError';
    this.status = status;
    this.code = code;
  }
}

export async function valetFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const communityId = getCommunityId();

  const res = await fetch(`${VALET_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('cg_admin_token');
    window.location.href = '/admin/login';
    throw new ValetError(401, 'unauthorized', 'Session expired');
  }

  if (!res.ok) {
    // Surface the service's own error code: the valet flow's 409s
    // ('scan_required', 'return_condition_required') are meaningful states the
    // UI must explain, not generic failures.
    let code = 'error';
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      code = body?.error || code;
      message = body?.message || message;
    } catch {
      /* non-JSON error body; keep the status text */
    }
    throw new ValetError(res.status, code, message);
  }

  return res.json();
}

export const valetPost = <T = unknown>(path: string, body?: unknown) =>
  valetFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

// --- shapes -----------------------------------------------------------------

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
  /** The printed card bound to this ticket, or null for a screen-QR ticket. */
  cardCode: string | null;
  /** The code the guest can type at /valet. Issued for every ticket. */
  claimCode: string | null;
}

export interface ValetTicketDetail extends ValetTicket {
  hasPhoto: boolean;
  events: Array<{
    event_type: string;
    guard_name: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export interface ConditionRecord {
  id: string;
  stage: 'intake' | 'return';
  mediaType: 'photo' | 'video';
  angle: 'front' | 'back' | 'left' | 'right' | null;
  capturedAt: string;
}

export interface PlateHistory {
  plate: string;
  visitCount: number;
  disputedCount: number;
  visits: Array<{
    displayId: string;
    plateAsEntered: string;
    createdAt: string;
    closedAt: string | null;
    status: ValetStatus;
    disputed: boolean;
    createdGuardName: string;
  }>;
}

/** Human labels for the flow's states, since the raw values read as jargon. */
export const STATUS_LABEL: Record<ValetStatus, string> = {
  parked: 'Parked',
  requested: 'Car requested',
  en_route: 'On its way',
  arrived: 'At pickup point',
  parked_again: 'Parked again',
  final_closed: 'Checked out',
  expired: 'Expired',
};

/** Which states need a guard to do something next. */
export const NEEDS_ACTION: ValetStatus[] = ['requested', 'arrived'];

export interface VisitRow {
  id: string;
  displayId: string;
  plate: string;
  vehicleMake: string;
  status: ValetStatus;
  arrivedAt: string;
  closedAt: string | null;
  staySeconds: number;
  disputed: boolean;
  takenInBy: string;
}

export interface VisitsReport {
  days: number;
  totals: {
    visits: number;
    uniqueVehicles: number;
    returningVehicles: number;
    disputed: number;
    stillOpen: number;
    avgStaySeconds: number;
  };
  visits: VisitRow[];
  paging: { limit: number; offset: number; returned: number };
}

/** Formats a stay as a manager would say it: "3h 20m", not 12000 seconds. */
export function formatStay(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}


// --- printed cards ----------------------------------------------------------

export interface ValetCard {
  id: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  /** Null when the card is back in the stack, ready to hand out. */
  inUseBy: { displayId: string; plate: string; status: ValetStatus } | null;
}

export interface SearchResult {
  displayId: string;
  sessionToken: string;
  plate: string;
  vehicleMake: string;
  status: ValetStatus;
  createdAt: string;
  closedAt: string | null;
  disputed: boolean;
  cardCode: string | null;
  claimCode: string | null;
  createdGuardName: string;
}

export const listCards = () => valetFetch<{ cards: ValetCard[] }>('/admin/cards');

export const registerCards = (body: { codes: string[] } | { prefix: string; from: number; to: number; width?: number }) =>
  valetPost<{ added: string[]; skipped: string[]; total: number }>('/admin/cards', body);

export const setCardActive = (id: string, active: boolean) =>
  valetPost<{ id: string; isActive: boolean }>(`/admin/cards/${id}/${active ? 'activate' : 'deactivate'}`);

export const searchPlates = (plate: string) =>
  valetFetch<{ query: string; tickets: SearchResult[] }>(
    `/admin/tickets/search?plate=${encodeURIComponent(plate)}`
  );

/**
 * Previews the codes a range will create, so an operator sees A001…A050
 * before committing rather than after. The service builds the real list; this
 * only has to agree with it on the common case.
 */
export function previewRange(prefix: string, from: number, to: number, width = 3): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return [];
  const out: string[] = [];
  for (let n = from; n <= Math.min(to, from + 499); n += 1) {
    out.push(`${prefix.toUpperCase()}${String(n).padStart(width, '0')}`);
  }
  return out;
}

// --- venue branding ---------------------------------------------------------

export const getBranding = () => valetFetch<{ hasLogo: boolean }>('/admin/branding');

export const removeVenueLogo = () =>
  valetFetch<{ hasLogo: boolean }>('/admin/branding/logo', { method: 'DELETE' });

/**
 * Multipart, so it cannot go through valetFetch: that sets a JSON content type,
 * and setting one by hand on a FormData body strips the boundary the server
 * needs to parse it.
 */
export async function uploadVenueLogo(file: File): Promise<{ hasLogo: boolean }> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const body = new FormData();
  body.append('logo', file);

  const res = await fetch(`${VALET_BASE}/admin/branding/logo`, {
    method: 'POST',
    body,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });

  if (!res.ok) {
    let code = 'error';
    let message = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      code = b?.error || code;
      message = b?.message || message;
    } catch {
      /* non-JSON error body */
    }
    throw new ValetError(res.status, code, message);
  }
  return res.json();
}

/**
 * The logo as an object URL.
 *
 * Fetched rather than pointed at with an <img src>: the route is admin-only
 * and a browser sends no Authorization header for an image request, so a plain
 * src would 401. Returns null when the venue has no logo.
 */
export async function fetchVenueLogo(): Promise<string | null> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const res = await fetch(`${VALET_BASE}/admin/branding/logo`, {
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

// --- parking inventory ------------------------------------------------------

export interface ValetSlot {
  id: string;
  floor: string;
  zone: string;
  number: string;
  /** Null when free. Derived from live tickets on every read, never stored. */
  occupiedBy: { displayId: string; plate: string; sessionToken: string } | null;
}

export const listSlots = () =>
  valetFetch<{ enabled: boolean; slots: ValetSlot[] }>('/admin/slots');

export const addSlots = (
  body: { floor: string; zone: string } & (
    | { numbers: string[] }
    | { from: number; to: number; width?: number }
  )
) => valetPost<{ added: string[]; skipped: string[] }>('/admin/slots', body);

export const retireSlot = (id: string) =>
  valetFetch<{ retired: boolean }>(`/admin/slots/${id}`, { method: 'DELETE' });

export const setSlotsEnabled = (enabled: boolean) =>
  valetFetch<{ enabled: boolean }>('/admin/slots/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

/**
 * Groups a flat slot list into the Floor > Zone shape the grid renders.
 *
 * Floors sort with basements descending below ground — B3, B2, B1, G, 1, 2 —
 * because that is how a garage is signposted, and a plain string sort would
 * put B1 above B3 and G after 9.
 */
export function groupSlots(slots: ValetSlot[]): {
  floor: string;
  zones: { zone: string; slots: ValetSlot[] }[];
}[] {
  const floors: { floor: string; zones: { zone: string; slots: ValetSlot[] }[] }[] = [];

  for (const slot of slots) {
    let floor = floors.find((f) => f.floor === slot.floor);
    if (!floor) floors.push((floor = { floor: slot.floor, zones: [] }));
    let zone = floor.zones.find((z) => z.zone === slot.zone);
    if (!zone) floor.zones.push((zone = { zone: slot.zone, slots: [] }));
    zone.slots.push(slot);
  }

  return floors.sort((a, b) => floorRank(a.floor) - floorRank(b.floor));
}

function floorRank(floor: string): number {
  const f = floor.toUpperCase();
  const basement = f.match(/^B(\d+)$/);
  if (basement) return -Number(basement[1]);
  if (f === 'G' || f === 'GF') return 0;
  const n = Number(f);
  return Number.isFinite(n) ? n : 999;
}

// --- feedback ---------------------------------------------------------------

export interface FeedbackRollup {
  days: number;
  satisfied: number;
  notSatisfied: number;
  reasons: { reason: string; count: number }[];
}

export const REASON_LABEL: Record<string, string> = {
  wrong_vehicle: 'Wrong vehicle',
  long_wait: 'Long wait',
  damage: 'Damage',
  staff_conduct: 'Staff conduct',
};

export const getFeedback = (days = 30) =>
  valetFetch<FeedbackRollup>(`/admin/feedback?days=${days}`);

// --- promotions, leads and subscription -------------------------------------

export interface Promotion {
  enabled: boolean;
  label: string | null;
  link: string | null;
}

export const getPromotion = () => valetFetch<Promotion>('/admin/promotion');

export const savePromotion = (label: string, link: string) =>
  valetFetch<Promotion>('/admin/promotion', {
    method: 'PATCH',
    body: JSON.stringify({ label, link }),
  });

export const requestAdvertising = (message: string) =>
  valetPost<{ logged: boolean }>('/admin/promotion/request', { message });

export const submitLead = (body: {
  product: string; contactName?: string; contactPhone?: string;
  contactEmail?: string; message?: string;
}) => valetPost<{ logged: boolean }>('/admin/leads', body);

export interface Subscription {
  plan: 'basic' | 'enterprise';
  quota: number | null;
  used: number;
  renewalDate: string | null;
  pooled: boolean;
}

export const getSubscription = () => valetFetch<Subscription>('/admin/subscription');
