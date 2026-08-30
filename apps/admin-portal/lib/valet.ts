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
