import { create } from 'zustand';
import * as api from '../api/valet';
import type { ValetTicket, ValetStatus } from '../api/valet';
import { rankRetrievals } from '../lib/retrievalScore';

/**
 * Valet queue state, one store per domain like the rest of this app.
 *
 * The ordering rule lives here rather than in the screen because it is the
 * product decision, not a presentation detail: a guest who has asked for their
 * car is standing in the lobby, so anything needing a valet outranks
 * everything parked, regardless of when it was created.
 */

/** States where a guest is actively waiting on a valet to do something. */
export const NEEDS_ACTION: ValetStatus[] = ['retrieval_requested', 'arrived'];

/**
 * The two halves of a shift.
 *
 * An attendant walking out to park a car and one walking back to fetch one
 * are doing different jobs, and a single list mixes them into a queue nobody
 * can read at a busy porch. A parked car appears in neither: it needs nobody
 * until a guest asks.
 */
const INBOUND: ValetStatus[] = ['requested', 'accepted', 'parking_in_progress'];

/**
 * Cars waiting to be fetched, ranked rather than first-in-first-out.
 *
 * The weighting lives in lib/retrievalScore.ts, on its own, because it is a
 * policy somebody will want to retune against real walking times and it
 * should not be buried in a store.
 */
export function rankedForDelivery(
  tickets: ValetTicket[], attendantAt: { floor: string; zone: string } | null
): ValetTicket[] {
  const waiting = tickets.filter((t) => t.status === 'retrieval_requested');
  const rest = forDelivery(tickets).filter((t) => t.status !== 'retrieval_requested');

  const ranked = rankRetrievals(
    waiting.map((t) => ({
      ticket: t,
      waitedMinutes: Math.max(0, (Date.now() - new Date(t.createdAt).getTime()) / 60000),
      slot: t.slot ? { floor: t.slot.floor, zone: t.slot.zone } : null,
    })),
    attendantAt
  ).map((x) => x.ticket);

  // Guests who have asked stay above everything parked, whatever the walk.
  return [...ranked, ...rest];
}

/** Cars still coming in — not yet parked. */
export function forParking(tickets: ValetTicket[]): ValetTicket[] {
  return sortQueue(tickets.filter((t) => INBOUND.includes(t.status)));
}

/**
 * Everything already on the lot, whether or not anyone has asked for it.
 *
 * The BRD's second tab is strictly "assigned for delivery", but this queue is
 * also how an attendant sees what is parked and finds a plate. Showing only
 * the cars somebody has asked for would add one capability by removing
 * another, so parked cars stay here and the urgent ones sort to the top.
 */
export function forDelivery(tickets: ValetTicket[]): ValetTicket[] {
  return sortQueue(tickets.filter((t) => !INBOUND.includes(t.status)));
}

/** States that no longer belong in a working queue. */
const CLOSED: ValetStatus[] = ['final_closed', 'expired'];

export function sortQueue(tickets: ValetTicket[]): ValetTicket[] {
  return [...tickets].sort((a, b) => {
    const aUrgent = NEEDS_ACTION.includes(a.status) ? 0 : 1;
    const bUrgent = NEEDS_ACTION.includes(b.status) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    // Within a group, whoever has waited longest goes first.
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

interface ValetState {
  tickets: ValetTicket[];
  loading: boolean;
  error: string | null;
  /** What the valet has typed into the queue's plate search. */
  search: string;

  fetch: () => Promise<void>;
  setSearch: (q: string) => void;
  /** The queue after the plate filter — what the screen actually renders. */
  visibleTickets: () => ValetTicket[];
  accept: (token: string, etaMinutes: number | null) => Promise<void>;
  arrived: (token: string) => Promise<void>;
  waitingCount: () => number;
}

/** Turns an axios failure into the service's own error code where there is one. */
function codeOf(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || 'request_failed';
}

export const useValetStore = create<ValetState>((set, get) => ({
  tickets: [],
  loading: false,
  error: null,
  search: '',

  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.listTickets();
      set({
        tickets: sortQueue((res.data.tickets || []).filter((t) => !CLOSED.includes(t.status))),
        error: null,
      });
    } catch (err) {
      // Keep whatever the guard is already looking at: a valet stand's
      // connection drops constantly and blanking the queue mid-shift is worse
      // than showing a slightly stale one.
      set({ error: codeOf(err) });
    } finally {
      set({ loading: false });
    }
  },

  accept: async (token, etaMinutes) => {
    try {
      await api.acceptTicket(token, etaMinutes);
      await get().fetch();
    } catch (err) {
      set({ error: codeOf(err) });
    }
  },

  arrived: async (token) => {
    try {
      await api.markArrived(token);
      await get().fetch();
    } catch (err) {
      set({ error: codeOf(err) });
    }
  },

  setSearch: (search) => set({ search }),

  // Filters what is already held rather than asking the server: a valet
  // hunting for one of forty parked cars needs the list to narrow as they
  // type, and the open queue is small enough that this is instant. Matching
  // is on the normalized plate so spacing and case never matter — the same
  // rule the server uses, so what they see here agrees with a wider search.
  visibleTickets: () => {
    const { tickets, search } = get();
    const q = search.replace(/\s+/g, '').toUpperCase();
    if (!q) return tickets;
    return tickets.filter((t) => t.plate.replace(/\s+/g, '').toUpperCase().includes(q));
  },

  waitingCount: () => get().tickets.filter((t) => NEEDS_ACTION.includes(t.status)).length,
}));
