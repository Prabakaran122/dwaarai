import { create } from 'zustand';
import * as api from '../api/client';

export interface Vehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  type: string;
  rfidTag?: string;
  fastagTidHash?: string;
  lastEntryAt?: string;
  createdAt: string;
}

interface VehicleState {
  vehicles: Vehicle[];
  loading: boolean;
  fetch: () => Promise<void>;
  add: (data: { plate: string; make: string; model: string; type: string }) => Promise<void>;
  update: (id: string, data: Partial<Vehicle>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function mapVehicle(raw: any): Vehicle {
  return {
    id: raw.id,
    plate: raw.plate_display || raw.plate,
    make: raw.make || '',
    model: raw.model || '',
    type: raw.type || 'car',
    rfidTag: raw.rfid_uid_hash,
    fastagTidHash: raw.fastag_tid_hash,
    lastEntryAt: raw.last_entry_at || undefined,
    createdAt: raw.created_at,
  };
}

export const useVehicleStore = create<VehicleState>((set) => ({
  vehicles: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getVehicles();
      const raw = res.data.data;
      const vehicles = Array.isArray(raw) ? raw.map(mapVehicle) : [];
      set({ vehicles });
    } finally {
      set({ loading: false });
    }
  },
  add: async (data) => {
    const res = await api.createVehicle(data);
    const vehicle = mapVehicle(res.data.data);
    set((s) => ({ vehicles: [...s.vehicles, vehicle] }));
  },
  update: async (id, data) => {
    const res = await api.updateVehicle(id, data);
    const vehicle = mapVehicle(res.data.data);
    set((s) => ({
      vehicles: s.vehicles.map((v) => (v.id === id ? vehicle : v)),
    }));
  },
  remove: async (id) => {
    await api.deleteVehicle(id);
    set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) }));
  },
}));
