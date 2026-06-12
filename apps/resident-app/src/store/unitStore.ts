import { create } from 'zustand';
import * as api from '../api/client';

export interface UnitMember { id: string; name: string; relationship: string | null; isPrimary: boolean; faceEnrolled: boolean; appAccess: boolean; }
export interface UnitVehicle { id: string; plate: string; makeModel: string | null; type: string; fastagLinked: boolean; }
export interface UnitProfile {
  unit: { unitNumber: string; floor: number | null; wing: string | null; ownershipType: string | null; communityName: string; verified: boolean } | null;
  members: UnitMember[];
  vehicles: UnitVehicle[];
  dues: { outstanding: number; pendingCount: number };
}
interface UnitState { profile: UnitProfile | null; loading: boolean; error: boolean; fetch: () => Promise<void>; }
export const useUnitStore = create<UnitState>((set) => ({
  profile: null, loading: false, error: false,
  fetch: async () => {
    set({ loading: true, error: false });
    try { const res = await api.getResidentUnit(); set({ profile: res.data.data as UnitProfile }); }
    catch { set({ error: true }); }
    finally { set({ loading: false }); }
  },
}));
