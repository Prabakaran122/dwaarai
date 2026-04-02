import { create } from 'zustand';

export interface QueueEntry {
  id: string;
  plate: string;
  method: 'anpr' | 'rfid' | 'fastag' | 'otp' | 'manual';
  decision: 'allow' | 'deny' | 'guard_review';
  reason?: string;
  timestamp: string;
  snapshot?: string;
  fastagTidHash?: string;
  unitNumber?: string;
  residentName?: string;
  autoPaired?: boolean;
  alertType?: 'unknown_vehicle' | 'auto_paired' | 'fastag_mismatch';
}

interface QueueState {
  entries: QueueEntry[];
  addEntry: (entry: QueueEntry) => void;
  removeEntry: (id: string) => void;
  clearQueue: () => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((s) => ({ entries: [entry, ...s.entries].slice(0, 50) })),
  removeEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clearQueue: () => set({ entries: [] }),
}));
