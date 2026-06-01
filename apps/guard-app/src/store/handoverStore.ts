import { create } from 'zustand';
import * as api from '../api/client';

export interface HandoverNote {
  note: string;
  guardName: string | null;
  createdAt: string;
}

export interface OpenItems {
  sosActive: number;
  deliveriesWaiting: number;
}

interface HandoverState {
  latest: HandoverNote | null;
  openItems: OpenItems;
  fetchLatest: () => Promise<void>;
  submit: (note: string) => Promise<void>;
}

export const useHandoverStore = create<HandoverState>((set) => ({
  latest: null,
  openItems: { sosActive: 0, deliveriesWaiting: 0 },
  fetchLatest: async () => {
    try {
      const res = await api.getLatestHandover();
      const d = res.data.data || {};
      set({
        latest: d.handover
          ? { note: d.handover.note, guardName: d.handover.guard_name ?? null, createdAt: d.handover.created_at }
          : null,
        openItems: {
          sosActive: d.open_items?.sos_active || 0,
          deliveriesWaiting: d.open_items?.deliveries_waiting || 0,
        },
      });
    } catch { /* non-critical */ }
  },
  submit: async (note) => {
    await api.postHandover(note);
  },
}));
