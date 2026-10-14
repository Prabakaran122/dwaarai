import { create } from 'zustand';

/**
 * Whether the backend is answering.
 *
 * Deliberately not NetInfo. "Is the radio on" is the wrong question at the two
 * places a valet actually stands: a basement access point with no uplink and a
 * hotel captive portal both report a healthy connection while swallowing every
 * request. What the attendant needs to know is whether the last thing they
 * tried reached the server, so that is what this measures.
 */

/**
 * A request that never got an answer, as opposed to one the server refused.
 *
 * axios leaves `response` unset when the exchange never completed -- DNS
 * failure, no route, or the 15s timeout expiring. Anything carrying a status
 * means we reached the building, and a 500 shown as "you are offline" sends an
 * attendant outside looking for signal while hiding a real outage.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { response?: unknown; code?: string };
  if (e.response) return false;
  // No response at all: a transport failure, or the timeout.
  return true;
}

interface Reachability {
  online: boolean;
  /** When the server last answered. Null until it ever has. */
  lastOkAt: number | null;
  noteSuccess: () => void;
  noteFailure: (err: unknown) => void;
  reset: () => void;
}

export const reachability = create<Reachability>((set) => ({
  // Optimistic on launch. Starting offline would flash a banner on every cold
  // start before the first poll has had a chance to succeed.
  online: true,
  lastOkAt: null,

  noteSuccess: () => set({ online: true, lastOkAt: Date.now() }),

  noteFailure: (err) => {
    if (!isNetworkFailure(err)) return;
    // lastOkAt is deliberately left alone: while offline it is the only thing
    // that can answer "how old is what I am looking at", which is the question
    // an attendant staring at a cached queue is actually asking.
    set({ online: false });
  },

  reset: () => set({ online: true, lastOkAt: null }),
}));
