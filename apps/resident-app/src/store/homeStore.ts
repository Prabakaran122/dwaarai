import { create } from 'zustand';
import * as api from '../api/client';

export interface ActivityEvent {
  id: string;
  ts: string;
  plate: string;
  method: string;
  direction: string;
  decision: string;
  residentName: string;
}

export interface PinnedNotice {
  id: string;
  title: string;
  authorName: string;
  createdAt: string;
}

export interface UpcomingEvent {
  id: string;
  title: string;
  location: string | null;
  startsAt: string;
}

export interface HomeSummary {
  gateGlance: {
    visitors: { expected: number };
    parcels: { pending: number };
    helpers: { expected: number; arrived: number };
  };
  recentActivity: ActivityEvent[];
  dues: { outstanding: number; earliestDueDate: string | null; pendingCount: number };
  community: { pinnedNotice: PinnedNotice | null; upcomingEvent: UpcomingEvent | null };
}

interface HomeState {
  summary: HomeSummary | null;
  loading: boolean;
  error: boolean;
  fetch: () => Promise<void>;
}

export const useHomeStore = create<HomeState>((set) => ({
  summary: null,
  loading: false,
  error: false,
  fetch: async () => {
    set({ loading: true, error: false });
    try {
      const res = await api.getResidentHome();
      set({ summary: res.data.data as HomeSummary });
    } catch {
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },
}));
