import { create } from 'zustand';
import * as api from '../api/client';

/**
 * Events tab state (BRD: Events Module v1.0).
 *
 * Money is never computed here. The gateway returns pricePaise,
 * platformFeePaise and totalPaise already worked out
 * (services/api-gateway/src/lib/money.js), and this store passes them straight
 * through — a second implementation of the 3% rule on the client is exactly
 * how a checkout total starts disagreeing with the receipt.
 */

export type EventFilter = 'all' | 'upcoming' | 'stalls' | 'donations' | 'past';

export interface EventItem {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  startsAt: string;
  endsAt: string | null;
  authorName: string | null;
  hasStalls: boolean;
  hasDonations: boolean;
  isFeatured: boolean;
  stallsAvailable: number;
  isPast?: boolean;
  coverUrl: string | null;
}

export interface Stall {
  id: string;
  code: string;
  stallType: 'standard' | 'premium' | 'corner';
  pricePaise: number;
  platformFeePaise: number;
  totalPaise: number;
  status: 'available' | 'booked';
  row: number;
  col: number;
}

export interface DonationFund {
  id: string;
  name: string;
  description: string | null;
  eventId: string | null;
  targetPaise: number;
  raisedPaise: number;
  percent: number;
  donorCount: number;
}

interface EventsState {
  events: EventItem[];
  funds: DonationFund[];
  filter: EventFilter;
  loading: boolean;
  error: boolean;

  fetch: () => Promise<void>;
  setFilter: (f: EventFilter) => void;
  visibleEvents: () => EventItem[];
  featured: () => EventItem | null;
  fundForEvent: (eventId: string) => DonationFund | null;
}

/** A past event is never bookable, so it is never featured either (FR-EVT-06). */
function isPast(e: EventItem): boolean {
  if (typeof e.isPast === 'boolean') return e.isPast;
  return new Date(e.startsAt).getTime() < Date.now();
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  funds: [],
  filter: 'all',
  loading: false,
  error: false,

  fetch: async () => {
    set({ loading: true, error: false });
    try {
      // Past events are wanted too — FR-EVT-06 keeps them visible but not
      // bookable, so the tab asks for both scopes rather than only upcoming.
      const [upcoming, past, funds] = await Promise.all([
        api.getEvents('upcoming'),
        api.getEvents('past'),
        api.getDonationFunds(),
      ]);
      const merged: EventItem[] = [
        ...(upcoming.data.data || []),
        ...(past.data.data || []).map((e: EventItem) => ({ ...e, isPast: true })),
      ];
      set({ events: merged, funds: funds.data.data || [] });
    } catch {
      // Keep what is already on screen; a failed refresh should not blank a
      // tab someone is reading.
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },

  setFilter: (filter) => set({ filter }),

  // FR-EVT-02. Filtering is client-side over data already held, so switching a
  // chip costs no request.
  visibleEvents: () => {
    const { events, filter } = get();
    const upcoming = events.filter((e) => !isPast(e));
    switch (filter) {
      case 'upcoming': return upcoming;
      case 'stalls': return upcoming.filter((e) => e.hasStalls);
      case 'donations': return upcoming.filter((e) => e.hasDonations);
      case 'past': return events.filter(isPast);
      default: return [...upcoming, ...events.filter(isPast)];
    }
  },

  // FR-EVT-03. Only an upcoming event can be the hero — featuring something
  // that already happened would put a dead card at the top of the tab.
  featured: () => get().events.find((e) => e.isFeatured && !isPast(e)) || null,

  fundForEvent: (eventId) => get().funds.find((f) => f.eventId === eventId) || null,
}));
