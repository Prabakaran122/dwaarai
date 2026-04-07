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

function priorityScore(entry: QueueEntry): number {
  if (entry.decision === 'deny') return 0;
  if (entry.alertType === 'fastag_mismatch') return 1;
  if (entry.decision === 'guard_review') return 2;
  return 3;
}

interface ShiftStats {
  shiftStart: string;
  totalEntries: number;
  totalDenied: number;
  totalVisitors: number;
}

interface QueueState {
  entries: QueueEntry[];
  shiftStats: ShiftStats;
  addEntry: (entry: QueueEntry) => void;
  removeEntry: (id: string) => void;
  clearQueue: () => void;
  resetShift: () => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  entries: [],
  shiftStats: {
    shiftStart: new Date().toISOString(),
    totalEntries: 0,
    totalDenied: 0,
    totalVisitors: 0,
  },

  addEntry: (entry) =>
    set((s) => {
      const newEntries = [entry, ...s.entries].slice(0, 50);
      const stats = { ...s.shiftStats };
      stats.totalEntries += 1;
      if (entry.decision === 'deny') stats.totalDenied += 1;
      if (entry.method === 'otp') stats.totalVisitors += 1;
      return { entries: newEntries, shiftStats: stats };
    }),

  removeEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  clearQueue: () => set({ entries: [] }),

  resetShift: () =>
    set({
      shiftStats: {
        shiftStart: new Date().toISOString(),
        totalEntries: 0,
        totalDenied: 0,
        totalVisitors: 0,
      },
    }),
}));

// Selectors
export function selectPendingEntries(entries: QueueEntry[]): QueueEntry[] {
  return entries
    .filter((e) => e.decision === 'guard_review' || e.decision === 'deny')
    .sort((a, b) => priorityScore(a) - priorityScore(b));
}

export function selectFeedEntries(entries: QueueEntry[]): QueueEntry[] {
  return entries;
}
