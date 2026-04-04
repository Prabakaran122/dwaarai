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

export const useVehicleStore = create<VehicleState>((set) => ({
  vehicles: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getVehicles();
      set({ vehicles: res.data.data });
    } finally {
      set({ loading: false });
    }
  },
  add: async (data) => {
    const res = await api.createVehicle(data);
    set((s) => ({ vehicles: [...s.vehicles, res.data.data] }));
  },
  update: async (id, data) => {
    const res = await api.updateVehicle(id, data);
    set((s) => ({
      vehicles: s.vehicles.map((v) => (v.id === id ? res.data.data : v)),
    }));
  },
  remove: async (id) => {
    await api.deleteVehicle(id);
    set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) }));
  },
}));
