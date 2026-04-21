import { create } from 'zustand';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  visitor_name: string;
  unit_number: string;
  gate_name: string;
  vehicle_plate: string | null;
  expires_at: string;
  status: ApprovalStatus;
  responded_by_name: string | null;
  residents_notified: number;
}

interface ApprovalStore {
  approvals: ApprovalRequest[];
  addApproval: (approval: ApprovalRequest) => void;
  updateApproval: (id: string, update: Partial<ApprovalRequest>) => void;
  removeApproval: (id: string) => void;
  clearAll: () => void;
}

export const useApprovalStore = create<ApprovalStore>((set) => ({
  approvals: [],

  addApproval: (approval) =>
    set((s) => ({ approvals: [approval, ...s.approvals] })),

  updateApproval: (id, update) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, ...update } : a
      ),
    })),

  removeApproval: (id) =>
    set((s) => ({
      approvals: s.approvals.filter((a) => a.id !== id),
    })),

  clearAll: () => set({ approvals: [] }),
}));
