import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../api/client';

const STORAGE_KEY = 'communitygate_guard_entitlements';

export type Tier = 'Starter' | 'Basic' | 'Pro' | 'Elite';

export interface Entitlements {
  fastag: boolean;
  anpr: boolean;
  face: boolean;
  aiAnomaly: boolean;
  tier: Tier;
  updatedAt: string | null;
}

// Starter (FASTag only) is the safe default before the first successful fetch
// — never show a layer the society hasn't been sold (BRD §5.6).
const DEFAULTS: Entitlements = { fastag: true, anpr: false, face: false, aiAnomaly: false, tier: 'Starter', updatedAt: null };

interface EntitlementState extends Entitlements {
  loading: boolean;
  fetch: () => Promise<void>;
  rehydrate: () => Promise<void>;
  applyUpdate: (data: Entitlements) => void;
}

export const useEntitlementStore = create<EntitlementState>((set) => ({
  ...DEFAULTS,
  loading: false,

  // Cached locally on launch (BRD §5.6: "Nazar fetches on app launch and caches locally").
  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) set(JSON.parse(raw));
    } catch { /* keep defaults */ }
  },

  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getEntitlements();
      const data = res.data.data as Entitlements;
      set({ ...data, loading: false });
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    } catch {
      // Offline or transient failure: keep whatever was cached/previously loaded.
      set({ loading: false });
    }
  },

  // Pushed live via the 'entitlement:updated' socket event (BRD NAZ-054: <=60s propagation).
  applyUpdate: (data) => {
    set({ ...data });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  },
}));
