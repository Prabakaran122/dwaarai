import { create } from 'zustand';
import * as api from '../api/valet';
import type { ValetTicket, ValetStatus } from '../api/valet';

/**
 * Valet queue state, one store per domain like the rest of this app.
 *
 * The ordering rule lives here rather than in the screen because it is the
 * product decision, not a presentation detail: a guest who has asked for their
 * car is standing in the lobby, so anything needing a valet outranks
 * everything parked, regardless of when it was created.
 */

/** States where a guest is actively waiting on a valet to do something. */
export const NEEDS_ACTION: ValetStatus[] = ['requested', 'arrived'];

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
