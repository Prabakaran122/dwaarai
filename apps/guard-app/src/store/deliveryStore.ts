import { create } from 'zustand';
import * as api from '../api/client';

export type DeliveryStatus = 'waiting' | 'delivered' | 'left_at_gate';

export interface Delivery {
  id: string;
  company: string;
  note: string | null;
  status: DeliveryStatus;
  unitNumber: string | null;
  createdAt: string;
}

interface DeliveryState {
  active: Delivery[];
  logging: boolean;
  fetchActive: () => Promise<void>;
  log: (unitNumber: string, company: string, note?: string) => Promise<void>;
  updateStatus: (id: string, status: 'delivered' | 'left_at_gate') => Promise<void>;
  addArrived: (raw: any) => void;
  removeById: (id: string) => void;
}

function mapDelivery(raw: any): Delivery {
  return {
    id: raw.id,
    company: raw.company,
    note: raw.note ?? null,
    status: raw.status,
    unitNumber: raw.unit_number ?? null,
    createdAt: raw.created_at,
  };
}

export const useDeliveryStore = create<DeliveryState>((set, get) => ({
  active: [],
  logging: false,
  fetchActive: async () => {
    try {
      const res = await api.getActiveDeliveries();
      const raw = res.data.data;
      set({ active: Array.isArray(raw) ? raw.map(mapDelivery) : [] });
    } catch { /* non-critical */ }
  },
  log: async (unitNumber, company, note) => {
    set({ logging: true });
    try {
      const res = await api.logDelivery(unitNumber, company, note);
      get().addArrived(res.data.data);
    } finally {
      set({ logging: false });
    }
  },
  updateStatus: async (id, status) => {
    await api.updateDeliveryStatus(id, status);
    get().removeById(id);
  },
  addArrived: (raw) => {
    const d = mapDelivery(raw);
    set((s) => (s.active.some((x) => x.id === d.id) ? s : { active: [d, ...s.active] }));
  },
  removeById: (id) => set((s) => ({ active: s.active.filter((d) => d.id !== id) })),
}));
