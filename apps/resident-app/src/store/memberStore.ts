import { create } from 'zustand';
import * as api from '../api/client';

export interface Member {
  id: string;
  name: string;
  mobile: string;
  relationship: string | null;
  type: string;
  isPrimary: boolean;
  notifyOnApproval: boolean;
  isSelf: boolean;
  createdAt: string;
}

interface MemberState {
  members: Member[];
  loading: boolean;
  fetch: () => Promise<void>;
  add: (data: { name: string; mobile: string; relationship?: string }) => Promise<void>;
  update: (id: string, data: { name?: string; relationship?: string; notify_on_approval?: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function mapMember(raw: any): Member {
  return {
    id: raw.id,
    name: raw.name,
    mobile: raw.mobile,
    relationship: raw.relationship ?? null,
    type: raw.type || 'owner',
    isPrimary: !!raw.is_primary,
    notifyOnApproval: raw.notify_on_approval !== false,
    isSelf: !!raw.is_self,
    createdAt: raw.created_at,
  };
}

export const useMemberStore = create<MemberState>((set) => ({
  members: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getMembers();
      const raw = res.data.data;
      const members = Array.isArray(raw) ? raw.map(mapMember) : [];
      set({ members });
    } finally {
      set({ loading: false });
    }
  },
  add: async (data) => {
    const res = await api.createMember(data);
    const member = mapMember(res.data.data);
    set((s) => ({ members: [...s.members, member] }));
  },
  update: async (id, data) => {
    const res = await api.updateMember(id, data);
    const member = mapMember(res.data.data);
    set((s) => ({ members: s.members.map((m) => (m.id === id ? member : m)) }));
  },
  remove: async (id) => {
    await api.deleteMember(id);
    set((s) => ({ members: s.members.filter((m) => m.id !== id) }));
  },
}));
