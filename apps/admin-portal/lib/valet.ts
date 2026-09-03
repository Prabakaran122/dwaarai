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
