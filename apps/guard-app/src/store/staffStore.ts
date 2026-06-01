import { create } from 'zustand';
import * as api from '../api/client';

export interface StaffMember {
  passId: string;
  name: string;
  role: string | null;
  unitNumber: string;
  arrived: boolean;
}

interface StaffState {
  roster: StaffMember[];
  loading: boolean;
  checkingIn: string | null;
  fetch: () => Promise<void>;
  checkIn: (passId: string) => Promise<void>;
}

function mapStaff(raw: any): StaffMember {
  return {
    passId: raw.pass_id,
    name: raw.name,
    role: raw.role ?? null,
    unitNumber: raw.unit_number,
    arrived: !!raw.arrived,
  };
}

export const useStaffStore = create<StaffState>((set, get) => ({
  roster: [],
  loading: false,
  checkingIn: null,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getStaff();
      const raw = res.data.data;
      set({ roster: Array.isArray(raw) ? raw.map(mapStaff) : [] });
    } finally {
      set({ loading: false });
    }
  },
  checkIn: async (passId) => {
    set({ checkingIn: passId });
    try {
      await api.checkinStaff(passId);
      // mark arrived locally
      set((s) => ({ roster: s.roster.map((m) => (m.passId === passId ? { ...m, arrived: true } : m)) }));
    } finally {
      set({ checkingIn: null });
    }
  },
}));
