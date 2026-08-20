import { create } from 'zustand';
import * as api from '../api/client';
import type { EventFilter } from '../api/client';

export interface EventItem {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  startsAt: string;
  createdAt: string;
  hasStalls: boolean;
  hasDonations: boolean;
  isFeatured: boolean;
  coverPath: string | null;
  goingCount?: number;
  myRsvp?: string | null;
}

export type StallStatus = 'available' | 'reserved' | 'booked';
export type StallType = 'standard' | 'premium' | 'corner';

export interface Stall {
  id: string;
  code: string;
  stallType: StallType;
  pricePaise: number;
  status: StallStatus;
  rowIndex: number;
  colIndex: number;
}

export interface Fund {
  id: string;
  name: string;
  description: string | null;
  targetPaise: number;
  raisedPaise: number;
  eventId: string | null;
  isOpen: boolean;
}

export interface StartedPayment {
  orderId: string;
  paymentOrderId: string;
  amount: number;
  currency: string;
  keyId: string | null;
  testMode: boolean;
}

export type BookResult =
  | { payment: StartedPayment }
  | { error: 'taken' | 'failed' };

/**
 * The BRD's tag vocabulary (FR-EVT-04). Pure so the labelling rule is
 * testable without rendering a card.
 */
export function tagsFor(e: Pick<EventItem, 'hasStalls' | 'hasDonations' | 'category'>): string[] {
  const tags: string[] = [];
  if (e.hasStalls) tags.push('Stalls available');
  if (e.hasDonations) tags.push('Donations open');
  if (e.category === 'festival' || e.category === 'kids') tags.push('Cultural');
  if (!e.hasStalls && !e.hasDonations) tags.push('Free entry');
  return tags;
}

/**
 * Whether the Events tab should show a new-content dot (FR-EVT-05).
 * A never-visited tab counts as having something new.
 */
export function hasUnseenEvents(newestCreatedAt: string | null, lastSeenIso: string | null): boolean {
  if (!newestCreatedAt) return false;
  if (!lastSeenIso) return true;
  return new Date(newestCreatedAt) > new Date(lastSeenIso);
}

interface EventsState {
  events: EventItem[];
  featured: EventItem | null;
  stalls: Stall[];
  funds: Fund[];
  filter: EventFilter;
  loading: boolean;
  error: boolean;
  fetch: () => Promise<void>;
  setFilter: (f: EventFilter) => Promise<void>;
  fetchStalls: (eventId: string) => Promise<void>;
  fetchFunds: () => Promise<void>;
  book: (eventId: string, stallId: string) => Promise<BookResult>;
  startDonation: (fundId: string, amountPaise: number) => Promise<BookResult>;
}

function shapePayment(d: any): StartedPayment {
  return {
    orderId: d.order_id ?? d.orderId,
    paymentOrderId: d.payment_order_id ?? d.paymentOrderId ?? d.id,
    amount: d.amount,
    currency: d.currency ?? 'INR',
    keyId: d.key_id ?? d.keyId ?? null,
    testMode: Boolean(d.test_mode ?? d.testMode),
  };
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  featured: null,
  stalls: [],
  funds: [],
  filter: 'all',
  loading: false,
  error: false,

  fetch: async () => {
    set({ loading: true, error: false });
    try {
      const res = await api.getEventsFeed(get().filter);
      const events: EventItem[] = res.data?.data ?? [];
      // The hero is pulled out rather than left inline so the list cannot
      // render it twice.
      set({
        events: events.filter((e) => !e.isFeatured),
        featured: events.find((e) => e.isFeatured) ?? null,
        loading: false,
      });
    } catch {
      set({ loading: false, error: true });
    }
  },

  setFilter: async (filter) => {
    set({ filter });
    await get().fetch();
  },

  fetchStalls: async (eventId) => {
    set({ loading: true, error: false });
    try {
      const res = await api.getStalls(eventId);
      set({ stalls: res.data?.data?.stalls ?? res.data?.data ?? [], loading: false });
    } catch {
      set({ loading: false, error: true });
    }
  },

  fetchFunds: async () => {
    try {
      const res = await api.getDonationFunds();
      set({ funds: res.data?.data ?? [] });
    } catch {
      set({ funds: [] });
    }
  },

  book: async (eventId, stallId) => {
    try {
      const res = await api.bookStall(eventId, stallId);
      return { payment: shapePayment(res.data?.data ?? {}) };
    } catch (err: any) {
      // The database guarantees a single winner; a 409 means someone else
      // took this stall between the map loading and the tap. Say that,
      // rather than showing a generic failure.
      if (err?.response?.status === 409) {
        await get().fetchStalls(eventId);
        return { error: 'taken' };
      }
      return { error: 'failed' };
    }
  },

  startDonation: async (fundId, amountPaise) => {
    try {
      const res = await api.donate(fundId, amountPaise);
      return { payment: shapePayment(res.data?.data ?? {}) };
    } catch {
      return { error: 'failed' };
    }
  },
}));
