import { create } from 'zustand';
import * as api from '../api/client';

export type FaceStatus = 'not_enrolled' | 'pending' | 'active' | 'deleted';
export type ConsentLocation = 'gate' | 'pool' | 'clubhouse' | 'gym';
export type ConsentMap = Record<ConsentLocation, boolean>;

export interface AccessLogEntry {
  location: string;
  method: 'face' | 'otp';
  decision: 'granted' | 'denied' | 'fallback';
  terminalId: string | null;
  eventTs: string;
}

interface FaceState {
  status: FaceStatus;
  recognitionReady: boolean;
  consents: ConsentMap;
  locations: ConsentLocation[];
  accessLog: AccessLogEntry[];
  loading: boolean;
  fetch: () => Promise<void>;
  enroll: (data: { consent_acknowledged: boolean; consent_locations?: string[]; scan_b64?: string }) => Promise<FaceStatus>;
  setConsent: (location: ConsentLocation, enabled: boolean) => Promise<void>;
  remove: () => Promise<void>;
  fetchAccessLog: () => Promise<void>;
}

const EMPTY: ConsentMap = { gate: false, pool: false, clubhouse: false, gym: false };

export const useFaceStore = create<FaceState>((set, get) => ({
  status: 'not_enrolled',
  recognitionReady: false,
  consents: { ...EMPTY },
  locations: ['gate', 'pool', 'clubhouse', 'gym'],
  accessLog: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getFaceIdentity();
      const d = res.data.data || {};
      set({
        status: d.status || 'not_enrolled',
        recognitionReady: !!d.recognition_ready,
        consents: { ...EMPTY, ...(d.consents || {}) },
        locations: Array.isArray(d.locations) ? d.locations : get().locations,
      });
    } finally {
      set({ loading: false });
    }
  },
  enroll: async (data) => {
    const res = await api.enrollFace(data);
    const status: FaceStatus = res.data.data?.status || 'pending';
    set({ status });
    await get().fetch();
    return status;
  },
  setConsent: async (location, enabled) => {
    // optimistic
    set((s) => ({ consents: { ...s.consents, [location]: enabled } }));
    try {
      const res = await api.setFaceConsent(location, enabled);
      const consents = res.data.data?.consents;
      if (consents) set({ consents: { ...EMPTY, ...consents } });
    } catch (e) {
      // revert on failure
      set((s) => ({ consents: { ...s.consents, [location]: !enabled } }));
      throw e;
    }
  },
  remove: async () => {
    await api.deleteFaceData();
    set({ status: 'not_enrolled', consents: { ...EMPTY } });
  },
  fetchAccessLog: async () => {
    const res = await api.getFaceAccessLog();
    const raw = res.data.data;
    set({
      accessLog: Array.isArray(raw)
        ? raw.map((e: any) => ({
            location: e.location,
            method: e.method,
            decision: e.decision,
            terminalId: e.terminal_id ?? null,
            eventTs: e.event_ts,
          }))
        : [],
    });
  },
}));
