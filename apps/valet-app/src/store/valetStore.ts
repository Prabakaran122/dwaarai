import { create } from 'zustand';
import * as api from '../api/valet';
import { reachability } from '../lib/connectivity';
import { saveQueue, loadQueue } from '../lib/queueCache';
import type { ValetTicket, ValetStatus } from '../api/valet';
import { rankRetrievals } from '../lib/retrievalScore';
import { isStatusChanged, errorCode } from '../lib/errors';

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
  return sortQueue(tickets.filter((t) => !INBOUND.includes(t.status) && t.status !== 'with_guest'));
}

/**
 * Cars handed to a multi-day guest and not yet brought back.
 *
 * Not on the lot and not a job until the guest returns -- these used to sit
 * under "On the lot" as "Parked again" while the guest was driving them.
 */
export function forWithGuest(tickets: ValetTicket[]): ValetTicket[] {
  return sortQueue(tickets.filter((t) => t.status === 'with_guest'));
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
  /** Loads the last cached queue. Called once on launch, before the first poll. */
  hydrate: () => Promise<void>;
  setSearch: (q: string) => void;
  /** The queue after the plate filter — what the screen actually renders. */
  visibleTickets: () => ValetTicket[];
  accept: (token: string, etaMinutes: number | null) => Promise<void>;
  arrived: (token: string) => Promise<void>;
  acceptIntake: (token: string) => Promise<void>;
  /** Abandons an intake that never finished, freeing its card. */
  cancelIntake: (token: string) => Promise<void>;
  waitingCount: () => number;
  /**
   * A short translation key for the queue to show after an action, or null.
   *
   * Separate from `error`, which is also set by every failed poll: a dropped
   * connection is the offline banner's job, and repeating it here on every
   * tick would bury the one message the attendant needs to read.
   */
  notice: string | null;
  clearNotice: () => void;
}

/** Turns an axios failure into the service's own error code where there is one. */
function codeOf(err: unknown): string {
  return errorCode(err) || 'request_failed';
}

export const useValetStore = create<ValetState>((set, get) => {
  /**
   * Every queue action is a status transition, and they all fail the same
   * two ways.
   *
   * 409 `status_changed` is not a fault: another valet got to the car first,
   * which two people reading the same queue will do. Saying "that failed, try
   * again" sends this one to try again on a car somebody else is already
   * driving. Say what happened and show the queue as it now is.
   */
  async function transition(call: () => Promise<unknown>): Promise<void> {
    try {
      await call();
      await get().fetch();
    } catch (err) {
      if (isStatusChanged(err)) {
        set({ error: 'status_changed', notice: 'valetStatusChanged' });
        await get().fetch();
        return;
      }
      set({ error: codeOf(err), notice: 'valetFailed' });
    }
  }

  return {
    tickets: [],
    loading: false,
    error: null,
    search: '',

    /**
     * Reads the queue cached by the last successful poll.
     *
     * The in-memory fallback below already covers a dropped connection mid-shift.
     * This covers the other half: an attendant force-quitting the app in a
     * basement and reopening it, where memory is gone and the radio still has
     * nothing. Without it that launch shows an empty lot.
     *
     * Never overwrites live data. A poll that lands while this is still reading
     * from disk is strictly fresher, and letting the cache win would walk the
     * queue backwards in front of somebody.
     */
    hydrate: async () => {
      if (get().tickets.length > 0) return;
      const cached = await loadQueue();
      if (!cached || get().tickets.length > 0) return;
      set({ tickets: sortQueue(cached.tickets.filter((t) => !CLOSED.includes(t.status))) });
    },

    fetch: async () => {
      set({ loading: true });
      try {
        const res = await api.listTickets();
        const tickets = sortQueue((res.data.tickets || []).filter((t) => !CLOSED.includes(t.status)));
        set({ tickets, error: null });
        reachability.getState().noteSuccess();
        // Fire and forget: the queue is already on screen, and a slow disk must
        // not hold up the next poll.
        void saveQueue(tickets);
      } catch (err) {
        // Keep whatever the guard is already looking at: a valet stand's
        // connection drops constantly and blanking the queue mid-shift is worse
        // than showing a slightly stale one.
        set({ error: codeOf(err) });
        // Only a transport failure means "offline". A 500 here means the server
        // answered, and saying otherwise sends an attendant hunting for signal.
        reachability.getState().noteFailure(err);
      } finally {
        set({ loading: false });
      }
    },

    accept: (token, etaMinutes) =>
      transition(() => api.acceptTicket(token, etaMinutes)),

    /**
     * Takes a job the desk logged.
     *
     * Refetches immediately: two attendants reading a stale queue is exactly
     * how they both walk to the same car.
     */
    acceptIntake: (token) => transition(() => api.acceptIntake(token)),

    arrived: (token) => transition(() => api.markArrived(token)),

    /**
     * A 409 `not_cancellable` means the car moved on -- somebody finished the
     * intake, or it was already cancelled -- while this attendant was deciding.
     * The fresh queue shows which; there is nothing to retry.
     */
    cancelIntake: async (token) => {
      try {
        await api.cancelIntake(token);
        set({ notice: 'valetIntakeCancelled' });
      } catch (err) {
        const code = errorCode(err);
        set({
          error: codeOf(err),
          notice: code === 'not_cancellable' ? 'valetNotCancellable' : 'valetFailed',
        });
      }
      await get().fetch();
    },

    notice: null,
    clearNotice: () => set({ notice: null }),

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
  };
});
