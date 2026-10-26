/**
 * Client for valet-service.
 *
 * Separate from lib/api.ts because valet-service is its own service on its own
 * base URL, but it accepts the same api-gateway JWT, so the credentials come
 * from exactly the same place. Keeping one token source means a session that
 * expires logs the operator out of both consistently.
 */

/**
 * Where valet-service lives, decided once at module load.
 *
 * The localhost fallback is a dev convenience only. A production bundle built
 * without NEXT_PUBLIC_VALET_API_URL used to ship it silently, so every valet
 * screen called the operator's own laptop and reported "could not reach the
 * valet service" -- a build that looked healthy and could not work. Throwing
 * here fails `next build` (it prerenders every page that imports this) instead.
 */
export function resolveValetBase(configured: string | undefined, nodeEnv: string | undefined): string {
  if (configured) return configured;
  if (nodeEnv === 'production') {
    throw new Error(
      'NEXT_PUBLIC_VALET_API_URL is not set. A production admin-portal build must name the ' +
      'valet-service URL (e.g. https://dwaarai.com/valet-api); refusing to fall back to localhost.'
    );
  }
  return 'http://localhost:3060';
}

// Both reads stay literal so Next inlines them into the client bundle.
export const VALET_BASE = resolveValetBase(process.env.NEXT_PUBLIC_VALET_API_URL, process.env.NODE_ENV);

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
    // Never onto the page we are already on -- that is a reload, and a
    // polling screen makes it a loop.
    if (window.location.pathname !== '/admin/login') {
      window.location.href = '/admin/login';
    }
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
    // "Token carries no community" is the server talking to itself. Every
    // screen prints err.message, so translate it once here, into the thing the
    // operator can actually do about it.
    if (code === 'no_community') message = PICK_PROPERTY_MESSAGE;
    throw new ValetError(res.status, code, message);
  }

  return res.json();
}

export const valetPost = <T = unknown>(path: string, body?: unknown) =>
  valetFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const valetPatch = <T = unknown>(path: string, body?: unknown) =>
  valetFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

// --- shapes -----------------------------------------------------------------

export type ValetStatus =
  | 'requested' | 'accepted' | 'parking_in_progress'
  | 'parked' | 'retrieval_requested' | 'en_route' | 'arrived'
  | 'parked_again' | 'with_guest' | 'final_closed' | 'expired';

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
  requested: 'Waiting to park',
  accepted: 'Attendant assigned',
  parking_in_progress: 'Parking',
  parked: 'Parked',
  retrieval_requested: 'Car requested',
  en_route: 'On its way',
  arrived: 'At pickup point',
  parked_again: 'Parked again',
  // Handed to a multi-day guest, not on the lot until checked back in.
  with_guest: 'With guest',
  final_closed: 'Checked out',
  expired: 'Expired',
};

/**
 * The status line for one ticket, given what happened to it.
 *
 * 'expired' is two different stories. A car that overstayed its booked stay is
 * genuinely expired; a ticket closed while still being taken in (a valet
 * cancelled it, or the stale-intake sweep closed one nobody finished) never
 * held a car at all, and "Expired" next to it reads as a car we lost track of.
 */
export function ticketStatusLabel(status: ValetStatus, eventTypes: string[] = []): string {
  if (status === 'expired') {
    if (eventTypes.includes('intake_cancelled')) return 'Cancelled at intake';
    if (eventTypes.includes('intake_abandoned')) return 'Intake not finished';
  }
  return STATUS_LABEL[status];
}

/**
 * The vehicle log's status cell.
 *
 * `handoverRecorded` is false for three different reasons, and only one of
 * them is an alarm: the car is still with us (not closed yet), the ticket was
 * closed at intake (no car was ever parked), or a closed ticket has no
 * handover on record (the sweep closed it). Painting all three amber as "No
 * handover recorded" made every car on the lot read as a missing handover.
 */
export function visitStatusCell(v: Pick<VisitRow, 'status' | 'handoverRecorded' | 'closedReason'>):
  { label: string; warn: boolean } {
  if (v.handoverRecorded) return { label: STATUS_LABEL[v.status], warn: false };
  if (v.status !== 'final_closed' && v.status !== 'expired') {
    return { label: STATUS_LABEL[v.status], warn: false };
  }
  if (v.closedReason === 'intake_cancelled') return { label: 'Cancelled at intake', warn: false };
  if (v.closedReason === 'intake_abandoned') return { label: 'Intake not finished', warn: false };
  return {
    label: v.status === 'expired' ? 'Expired, no handover recorded' : 'No handover recorded',
    warn: true,
  };
}

/**
 * What to show for a failed valet call, by the service's code rather than the
 * bare status: a 403 is "no property chosen" far more often than "wrong kind of
 * account", and reporting the first as the second sends a super admin hunting
 * for a permission they already have.
 */
export const PICK_PROPERTY_MESSAGE = 'Pick a property to view its valet data.';

export function valetErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ValetError)) return fallback;
  if (err.code === 'no_community') return PICK_PROPERTY_MESSAGE;
  if (err.code === 'forbidden') return 'This needs an admin account.';
  return err.message || fallback;
}

/** Which states need a guard to do something next. */
export const NEEDS_ACTION: ValetStatus[] = ['retrieval_requested', 'arrived'];

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
  /** Null while the car is still on the lot, and for a ticket that expired
   *  rather than being handed over -- nobody brought that one out. */
  handedOutBy: string | null;
  /** Which visit this is for this plate at this venue. 1 is a first-timer. */
  visitNumber: number;
  /**
   * Whether a person handed this car back, as opposed to the retention sweep
   * closing the ticket days later. False means the parking time and the guest
   * receipt are both missing, so the row is a record of arrival only.
   */
  handoverRecorded: boolean;
  /**
   * Why a ticket closed with no handover, when the service says. Optional:
   * older services omit it and the log falls back to the generic wording.
   */
  closedReason?: 'intake_cancelled' | 'intake_abandoned' | 'expired' | null;
}

/** The vehicle log's narrowing, named so both the page and the export agree. */
export type VisitStatus = 'returned' | 'no_handover' | 'parked';

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  returned: 'Handed back by a person',
  no_handover: 'No handover recorded',
  parked: 'Still with your team',
};

export interface VisitsReport {
  days: number;
  status: VisitStatus | null;
  /**
   * The explicit window, when one is in force; null when the report is a
   * named one. The page says "last 30 days" or "20-22 Aug" from this rather
   * than guessing from the parameters it happened to send.
   */
  range: { from: string; to: string } | null;
  totals: {
    visits: number;
    uniqueVehicles: number;
    returningVehicles: number;
    disputed: number;
    stillOpen: number;
    avgStaySeconds: number;
    /** How many of `visits` a person actually handed back. */
    withHandover: number;
    /** Check-ins cancelled by staff or abandoned: no car was ever parked. */
    unfinishedIntakes?: number;
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
  /** Where the card is; computed by the service (see cardState there). */
  state?: CardState;
  /** Why an out-of-use card is out (null for older retirements). */
  retiredReason?: 'lost' | 'damaged' | null;
  retiredAt?: string | null;
  /** Null when the card is back in the stack, ready to hand out. */
  inUseBy: {
    displayId: string; plate: string; status: ValetStatus;
    sessionToken?: string; vehicleMake?: string | null; since?: string;
    scannedAt?: string | null; hasWhatsApp?: boolean; handedOutBy?: string | null;
  } | null;
}

export type CardState = 'available' | 'waiting_scan' | 'with_guest' | 'overdue' | 'out_of_use';

export interface CardUse {
  displayId: string; plate: string | null; vehicleMake: string | null; status: ValetStatus;
  sessionToken: string; createdAt: string; closedAt: string | null; handedOutBy: string | null;
}

export const cardHistory = (id: string) =>
  valetFetch<{ uses: CardUse[] }>(`/admin/cards/${id}/history`);

export const resendCardTicket = (id: string) =>
  valetPost<{ status: string }>(`/admin/cards/${id}/resend`);

export const markCardReturned = (id: string) =>
  valetPost<{ ok: true; displayId: string }>(`/admin/cards/${id}/return`);

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

export const listCards = () =>
  valetFetch<{ cards: ValetCard[]; cardUrlBase?: string }>('/admin/cards');

/** Print-ready QR images for registered cards (at most 120 a sheet). */
export const cardQrSheet = (codes: string[]) =>
  valetPost<{ cards: { code: string; url: string; qr: string }[]; notRegistered: string[] }>(
    '/admin/cards/qr', { codes }
  );

export const registerCards = (body: { codes: string[] } | { prefix: string; from: number; to: number; width?: number }) =>
  valetPost<{ added: string[]; skipped: string[]; total: number }>('/admin/cards', body);

export const setCardActive = (id: string, active: boolean, reason?: 'lost' | 'damaged') =>
  valetPost<{ id: string; isActive: boolean }>(
    `/admin/cards/${id}/${active ? 'activate' : 'deactivate'}`,
    active ? undefined : { reason }
  );

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
  /**
   * The same responses, against the attendant the guest met at handover —
   * "review with staff", from the redesign. `enoughToJudge` is the server's
   * call, not the page's, so an export cannot quietly disagree about what
   * counts as a pattern rather than a bad week.
   */
  byStaff: {
    id: string;
    name: string;
    rated: number;
    unhappy: number;
    reasons: string[];
    enoughToJudge: boolean;
  }[];
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
  spendLimitPaise?: number | null;
  showFrom?: string | null;
  showTo?: string | null;
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

/**
 * Downloads the vehicle log.
 *
 * Fetched with the session token and handed to the browser as a blob, not
 * pointed at with an <a href>: the route is admin-only and a browser sends no
 * Authorization header on a plain navigation, so a direct link would 401.
 */
/**
 * The two date inputs, as the instants they mean.
 *
 * `<input type="date">` hands back a bare 2026-08-20, which `new Date()` reads
 * as UTC midnight. For a manager in India that is half past five in the
 * morning -- so a Saturday night's cars land in the wrong day at both ends.
 * Constructing from the parts builds the date in the browser's own zone, which
 * is the venue's, which is what they meant.
 *
 * `to` is the END of the day typed, because a range of 20th to 22nd that
 * silently excluded the 22nd would be wrong in the quiet way: nobody notices
 * until they count.
 */
export function dayRangeToInstants(from: string, to: string): { from: string; to: string } | null {
  const parse = (d: string, endOfDay: boolean) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    const [, y, mo, da] = m;
    return endOfDay
      ? new Date(+y, +mo - 1, +da, 23, 59, 59, 999)
      : new Date(+y, +mo - 1, +da, 0, 0, 0, 0);
  };
  const a = parse(from, false);
  const b = parse(to, true);
  if (!a || !b) return null;
  return { from: a.toISOString(), to: b.toISOString() };
}

export async function downloadVisitsCsv(
  days = 30,
  range: { from: string; to: string } | null = null,
  status: VisitStatus | null = null
): Promise<void> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const qs = range
    ? new URLSearchParams({ from: range.from, to: range.to })
    : new URLSearchParams({ days: String(days) });
  if (status) qs.set('status', status);

  const res = await fetch(`${VALET_BASE}/admin/visits.csv?${qs}`, {
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });
  if (!res.ok) throw new ValetError(res.status, 'export_failed', 'Could not build that export');

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `vehicle-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- locations and staff ----------------------------------------------------

export interface Location {
  id: string;
  name: string;
  address: string | null;
  plan: 'basic' | 'enterprise';
  parkedNow: number;
  waiting: number;
  onShift: number;
  carsThisMonth: number;
  /** Today's request-to-handover average. Null when nothing was handed over. */
  avgWaitSeconds: number | null;
  /**
   * Whether this desk has ever taken a car in.
   *
   * Deliberately not a sync status. Valet has no edge node — the app talks
   * straight to the API — so "last synced 12 minutes ago" would be a number
   * with nothing behind it.
   */
  status: 'live' | 'setting_up';
}

/**
 * Point the whole portal at one property.
 *
 * The same key every other screen already reads, so switching here switches
 * the queue, the vehicle log and the staff list with it. The server checks the
 * property actually belongs to the caller's account before honouring it — this
 * is a convenience, never the permission.
 */
export function selectCommunity(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem('cg_selected_community_id', id);
  else localStorage.removeItem('cg_selected_community_id');
}

export function selectedCommunity(): string | null {
  return typeof window === 'undefined'
    ? null
    : localStorage.getItem('cg_selected_community_id');
}

export const listLocations = () =>
  valetFetch<{
    locations: Location[];
    totals: { properties: number; parkedNow: number; waiting: number; onShift: number };
  }>('/admin/locations');

export type StaffRole = 'valet' | 'valet_manager' | 'temporary_driver';

export interface StaffMember {
  id: string;
  name: string;
  mobile: string;
  role: StaffRole;
  until: string | null;
  /** A temp whose end date has passed, still on the list and needing attention. */
  expired: boolean;
  /** Whether their face is on file. Somebody unenrolled cannot start a shift. */
  faceEnrolled: boolean;

  /** On duty right now, i.e. an open shift exists. */
  onShift: boolean;
  /** When the open shift began. Null when off duty. */
  shiftStartedAt: string | null;
  /** When the last finished shift ended. Null if they have never worked one. */
  lastEndedAt: string | null;

}

export interface Shift {
  id: string;
  name: string;
  role: StaffRole;
  startedAt: string;
  /** Null means still on shift, not missing. */
  endedAt: string | null;
  secondsOnShift: number;
  valetPoint: string | null;
  /** 'face_id' only on a real match; null carries a `reason` instead. */
  verifiedBy: 'face_id' | null;
  reason: string | null;
}

/** Why a shift started without the attendant being verified. */
export const SHIFT_REASON_LABEL: Record<string, string> = {
  no_photo: 'No photo taken',
  attendant_not_enrolled: 'Face ID not set up',
  recognition_not_configured: 'Face check unavailable',
  no_match: 'Face did not match',
};

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  // First, because it is what most of a valet desk is.
  valet: 'Valet',
  valet_manager: 'Valet manager',
  temporary_driver: 'Temporary driver',
};

export const listStaff = () => valetFetch<{ staff: StaffMember[] }>('/admin/staff');

/**
 * Correct a member of staff in place.
 *
 * `until: null` clears the end date; omitting it leaves it alone. Mobile is
 * not editable — it is how they sign in, and changing that mid-shift is a
 * different and more dangerous operation.
 */
export const editStaff = (id: string, body: {
  name?: string; role?: StaffRole; until?: string | null;
}) => valetPatch<{ id: string; name: string }>(`/admin/staff/${id}`, body);

export const listShifts = (
  days = 7,
  staffId = '',
  range: { from: string; to: string } | null = null
) => {
  const qs = range
    ? new URLSearchParams({ from: range.from, to: range.to })
    : new URLSearchParams({ days: String(days) });
  if (staffId) qs.set('staffId', staffId);
  return valetFetch<{
    days: number;
    range: { from: string; to: string } | null;
    shifts: Shift[];
  }>(`/admin/shifts?${qs}`);
};

export const addStaff = (body: {
  name: string; mobile: string; password: string; role: StaffRole; until?: string;
}) => valetPost<{ added: boolean }>('/admin/staff', body);

/**
 * Puts a member of staff's face on file for shift-start verification.
 *
 * The photo is sent once and is not kept -- what is stored is the vector the
 * recogniser derives from it. Fails loudly when recognition is unavailable
 * rather than recording somebody as enrolled who is not.
 */
/** Whether a recogniser exists to send a photo to. */
export const faceStatus = () =>
  valetFetch<{ configured: boolean }>('/admin/face/status');

export const enrolStaffFace = (id: string, imageBase64: string) =>
  valetPost<{ enrolled: boolean }>(`/admin/staff/${id}/face`, { imageBase64 });

export const retireStaff = (id: string) =>
  valetFetch<{ retired: boolean }>(`/admin/staff/${id}`, { method: 'DELETE' });

/**
 * Logs a car that has pulled up, before a valet reaches it.
 *
 * The plate is optional: the desk often has a car in front of them and no
 * chance to read a registration before the guest is out of it.
 */
export const logArrival = (plate?: string) =>
  valetPost<{ displayId: string }>('/admin/tickets/request', { plate });


/* ---------------------------------------------------------------- ideas -- */

export type IdeaCategory = 'not_working' | 'make_better' | 'our_hotel' | 'something_new';
export type IdeaStatus =
  | 'received' | 'looking_into_it' | 'planned' | 'being_built' | 'live' | 'not_planned';
export type IdeaImpact = 'a_little' | 'daily' | 'a_lot';

export interface Idea {
  id: string;
  category: IdeaCategory;
  title: string;
  body: string;
  impact: IdeaImpact | null;
  callback: boolean;
  status: IdeaStatus;
  /** The one line we have said about it. Null until somebody has. */
  latestUpdate: string | null;
  createdAt: string;
}

/** What each category is for. The description is the half that makes it clear. */
export const IDEA_CATEGORY: Record<IdeaCategory, { label: string; hint: string }> = {
  not_working:   { label: "Something isn't working", hint: 'A bug, an error, or a screen that behaves oddly' },
  make_better:   { label: 'Make something better',   hint: "A step that's slow, confusing or takes too many taps" },
  our_hotel:     { label: 'A problem unique to our hotel', hint: 'Your layout, events, guests or way of working' },
  something_new: { label: 'An idea for something new', hint: "A feature or service you'd pay for" },
};

export const IDEA_IMPACT: Record<IdeaImpact, string> = {
  a_little: 'A little',
  daily: 'Every day',
  a_lot: 'A lot — it costs us real time',
};

/**
 * Status as a venue reads it, not as the database stores it.
 *
 * "Received" is deliberately honest: it means somebody has it, not that
 * anybody has read it yet. Claiming otherwise is the fastest way to stop a
 * hotel bothering to write again.
 */
export const IDEA_STATUS: Record<IdeaStatus, { label: string; tone: string }> = {
  received:        { label: 'Received',        tone: 'bg-gray-100 text-gray-700' },
  looking_into_it: { label: 'Looking into it', tone: 'bg-blue-100 text-blue-800' },
  planned:         { label: 'Planned',         tone: 'bg-indigo-100 text-indigo-800' },
  being_built:     { label: 'Being built',     tone: 'bg-amber-100 text-amber-800' },
  live:            { label: 'Live',            tone: 'bg-teal-100 text-teal-800' },
  not_planned:     { label: 'Not planned',     tone: 'bg-gray-100 text-gray-500' },
};

export const listIdeas = () =>
  valetFetch<{ totals: { sent: number; live: number }; ideas: Idea[] }>('/admin/ideas');

export const sendIdea = (body: {
  category: IdeaCategory; title: string; body: string;
  impact?: IdeaImpact; callback?: boolean;
}) => valetPost<{ id: string; createdAt: string }>('/admin/ideas', body);


/* -------------------------------------------------------- valet points -- */

export type PointStatus = 'active' | 'events_only' | 'paused';

export interface ValetPoint {
  id: string;
  name: string;
  status: PointStatus;
  /** Null when the venue genuinely does not know; never faked as 0. */
  capacity: number | null;
  onShift: number;
}

export const POINT_STATUS: Record<PointStatus, { label: string; tone: string }> = {
  active:      { label: 'Active',      tone: 'bg-teal-100 text-teal-800' },
  events_only: { label: 'Events only', tone: 'bg-indigo-100 text-indigo-800' },
  paused:      { label: 'Paused',      tone: 'bg-gray-100 text-gray-500' },
};

export const listPoints = () => valetFetch<{ points: ValetPoint[] }>('/admin/points');

export const addPoint = (body: { name: string; capacity?: number; status?: PointStatus }) =>
  valetPost<{ id: string; name: string }>('/admin/points', body);

export const setPointStatus = (id: string, status: PointStatus) =>
  valetPatch<{ id: string; status: PointStatus }>(`/admin/points/${id}`, { status });

/**
 * Rename a point, re-count its bays, or both.
 *
 * `capacity: null` is a real value — "we have never counted" — so it is sent
 * rather than omitted. Omitting a field is how the server is told to leave it
 * alone, and the two must not be the same thing.
 */
export const editPoint = (
  id: string,
  body: { name?: string; capacity?: number | null; status?: PointStatus }
) => valetPatch<{ id: string; name: string; capacity: number | null; status: PointStatus }>(
  `/admin/points/${id}`, body
);


/* --------------------------------------------------- quota and advertising -- */

/**
 * Money arrives as integer paise and is NEVER recomputed here.
 *
 * The server owns every rate, the GST and the totals, exactly as the Events
 * module does — a second implementation of the arithmetic is a second answer,
 * and the one on the invoice has to be the one on the screen.
 */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  // Paise are shown only when there are any: a rate card reading "₹1.5"
  // looks like a typo, and "₹2,000.00" beside it is noise. Whole rupees stay
  // whole, anything with paise gets both digits.
  const hasPaise = Math.abs(paise) % 100 !== 0;
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export type QuotaMode = 'shared' | 'fixed';
export type OverBehaviour = 'bill' | 'notify';

export interface QuotaReport {
  settings: {
    mode: QuotaMode;
    carsPerProperty: number;
    alertPercent: number;
    overBehaviour: OverBehaviour;
    /** Null when no overage rate has been agreed — the screen says so. */
    overagePaise: number | null;
  };
  pool: {
    mode: QuotaMode;
    includedCars: number;
    usedCars: number;
    heldBackCars: number;
    /** Null under a fixed limit: there is no shared remainder to report. */
    sharedRemaining: number | null;
    overageCars: number;
    daysLeft: number;
  };
  properties: {
    id: string; name: string; holdBack: number;
    carsThisMonth: number; includedCars: number;
    status: 'live' | 'setting_up';
  }[];
}

export const getQuota = () => valetFetch<QuotaReport>('/admin/quota');

export const saveQuota = (body: {
  mode?: QuotaMode;
  alertPercent?: number;
  overBehaviour?: OverBehaviour;
  holdBack?: Record<string, number>;
}) => valetPatch<{ saved: boolean }>('/admin/quota', body);

export interface AdsReport {
  pricing: {
    perViewPaise: number;
    monthlyMinimumPaise: number;
    gstPercent: number;
    billing: 'prepaid' | 'invoiced';
  };
  balance: { creditPaise: number; paidPaise: number; totalPaise: number };
  monthToDate: { views: number; netPaise: number; gstPaise: number; totalPaise: number };
  ledger: {
    kind: string; amountPaise: number; isCredit: boolean;
    note: string | null; orderRef: string | null; at: string;
  }[];
  /** True while no money can actually be collected. Never inferred. */
  paymentPlaceholder: boolean;
}

export const getAds = () => valetFetch<AdsReport>('/admin/ads');

export const topUpAds = (amountPaise: number) =>
  valetPost<{
    orderId: string; netPaise: number; gstPaise: number; totalPaise: number;
    paymentPlaceholder: boolean; credited: boolean;
  }>('/admin/ads/topup', { amountPaise });

export const submitPromotion = (id: string) =>
  valetPost<{ id: string; status: PromotionStatus }>(`/admin/promotions/${id}/submit`, {});

/* ----------------------------------------------------- promotion banner -- */

export type PromotionStatus = 'draft' | 'in_review' | 'live' | 'paused' | 'ended';

export interface Promotion {
  id: string;
  headline: string;
  body: string | null;
  hasImage: boolean;
  buttonLabel: string | null;
  buttonUrl: string | null;
  offerCode: string | null;
  redeemNote: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: PromotionStatus;
  createdAt: string;
  /** One per valet ticket, not per page load. See the migration for why. */
  views: number;
  taps: number;
  redeems: number;
}

export const PROMOTION_STATUS: Record<PromotionStatus, { label: string; tone: string }> = {
  draft:  { label: 'Draft',  tone: 'bg-gray-100 text-gray-700' },
  // Sent to us and not yet in front of a guest. Distinct from Draft because
  // the venue can no longer edit it, and from Live because nobody has seen it.
  in_review: { label: 'In review', tone: 'bg-indigo-100 text-indigo-800' },
  live:   { label: 'Live',   tone: 'bg-teal-100 text-teal-800' },
  paused: { label: 'Paused', tone: 'bg-amber-100 text-amber-800' },
  ended:  { label: 'Ended',  tone: 'bg-gray-100 text-gray-500' },
};

export const listPromotions = () =>
  valetFetch<{ promotions: Promotion[] }>('/admin/promotions');

export const createPromotion = (body: {
  headline: string; body?: string; buttonLabel?: string; buttonUrl?: string;
  offerCode?: string; redeemNote?: string; startsAt?: string; endsAt?: string;
  spendLimitPaise?: number; showFrom?: string; showTo?: string;
}) => valetPost<{ id: string; status: PromotionStatus }>('/admin/promotions', body);

export const setPromotionStatus = (id: string, status: PromotionStatus) =>
  valetPatch<{ id: string; status: PromotionStatus }>(`/admin/promotions/${id}`, { status });

export const redeemGuestCode = (promotionId: string, code: string) =>
  valetPost<{ redeemed: boolean }>(`/admin/promotions/${promotionId}/redeem`, { code });

/** Multipart, like the venue logo: the banner is a file, not a field. */
export async function uploadPromotionImage(id: string, file: File): Promise<void> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`${VALET_BASE}/admin/promotions/${id}/image`, {
    method: 'POST',
    body: form,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });
  if (!res.ok) throw new ValetError(res.status, 'upload_failed', 'Could not upload that image');
}


/* ------------------------------------------------------ property details -- */

export interface PropertyDetails {
  name: string;
  address: string | null;
  deskPhone: string | null;
  hours: string | null;
  wentLiveAt: string | null;
  /** Who to call about this property. */
  admin: string | null;
  /** Cars on the lot right now — the other half of "on shift now". */
  parkedNow: number;
  /** Reported, not stored: it is what the product does, not a venue setting. */
  ticketType: string;
  /** One number per deployment, so not editable per property. */
  guestWhatsApp: string | null;
}

export const getProperty = () => valetFetch<PropertyDetails>('/admin/property');

export const saveProperty = (body: {
  address?: string; deskPhone?: string; hours?: string;
}) => valetPatch<{ saved: boolean }>('/admin/property', body);

async function downloadCsv(path: string, name: string): Promise<void> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const res = await fetch(`${VALET_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });
  if (!res.ok) throw new ValetError(res.status, 'export_failed', 'Could not build that export');

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** The shift log and promotion numbers, line by line. */
/**
 * The shift log as a file, narrowed exactly as the screen is.
 *
 * A manager who has filtered to one attendant on one day and then downloads a
 * month has the wrong evidence in their hand, and a CSV looks right until
 * somebody counts it.
 */
export const downloadShiftsCsv = (
  days = 30,
  staffId = '',
  range: { from: string; to: string } | null = null
) => {
  const qs = range
    ? new URLSearchParams({ from: range.from, to: range.to })
    : new URLSearchParams({ days: String(days) });
  if (staffId) qs.set('staffId', staffId);
  return downloadCsv(`/admin/shifts.csv?${qs}`, 'shift-log');
};
/** The group screen as a file — what a regional manager forwards. */
export const downloadLocationsCsv = () =>
  downloadCsv('/admin/locations.csv', 'properties');
export const downloadPromotionsCsv = () =>
  downloadCsv('/admin/promotions.csv', 'promotions');

/** A screenshot on an idea. Sent after the idea exists, like a promo banner. */
export async function uploadIdeaImage(id: string, file: File): Promise<void> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('cg_admin_token') || '';
  const communityId =
    typeof window === 'undefined' ? null : localStorage.getItem('cg_selected_community_id');

  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`${VALET_BASE}/admin/ideas/${id}/image`, {
    method: 'POST',
    body: form,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(communityId ? { 'X-Community-Id': communityId } : {}),
    },
  });
  if (!res.ok) throw new ValetError(res.status, 'upload_failed', 'Could not upload that image');
}

/**
 * Visits that ended with a car to hand back -- the only ones a missing
 * handover can be held against. A car still parked has not been handed over
 * yet, and a cancelled or abandoned check-in never had a car to hand over.
 */
export function finishedVisits(t: { visits: number; stillOpen: number; unfinishedIntakes?: number }): number {
  return Math.max(0, t.visits - t.stillOpen - (t.unfinishedIntakes ?? 0));
}
