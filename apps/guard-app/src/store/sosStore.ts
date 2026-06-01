import { create } from 'zustand';
import * as api from '../api/client';

export type SosType = 'medical' | 'fire' | 'security' | 'other';

export interface SosAlert {
  id: string;
  type: SosType;
  note: string | null;
  gateId: string | null;
  raisedByName: string | null;
  createdAt: string;
}

interface SosState {
  active: SosAlert[];
  raising: boolean;
  fetchActive: () => Promise<void>;
  raise: (type: SosType, note?: string) => Promise<void>;
  resolve: (id: string) => Promise<void>;
  // WebSocket-driven
  addAlert: (raw: any) => void;
  removeAlert: (id: string) => void;
}

function mapAlert(raw: any): SosAlert {
  return {
    id: raw.id,
    type: raw.type,
    note: raw.note ?? null,
    gateId: raw.gate_id ?? null,
    raisedByName: raw.raised_by_name ?? null,
    createdAt: raw.created_at,
  };
}

export const useSosStore = create<SosState>((set, get) => ({
  active: [],
  raising: false,
  fetchActive: async () => {
    try {
      const res = await api.getActiveSos();
      const raw = res.data.data;
      set({ active: Array.isArray(raw) ? raw.map(mapAlert) : [] });
    } catch { /* non-critical */ }
  },
  raise: async (type, note) => {
    set({ raising: true });
    try {
      const res = await api.raiseSos(type, note);
      get().addAlert(res.data.data); // optimistic; WS echo is de-duped
    } finally {
      set({ raising: false });
    }
  },
  resolve: async (id) => {
    await api.resolveSos(id);
    get().removeAlert(id);
  },
  addAlert: (raw) => {
    const alert = mapAlert(raw);
    set((s) => (s.active.some((a) => a.id === alert.id) ? s : { active: [alert, ...s.active] }));
  },
  removeAlert: (id) => set((s) => ({ active: s.active.filter((a) => a.id !== id) })),
}));
