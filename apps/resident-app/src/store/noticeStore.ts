import { create } from 'zustand';
import * as api from '../api/client';

export interface Notice {
  id: string;
  category: 'official' | 'discussion';
  title: string;
  body: string;
  authorName: string;
  authorUnit: string | null;
  postedByRole: 'resident' | 'admin';
  isPinned: boolean;
  authorResidentId: string | null;
  replyCount: number;
  createdAt: string;
  lastActivityAt: string;
}

export interface NoticeReply {
  id: string;
  noticeId: string;
  body: string;
  authorName: string;
  authorUnit: string | null;
  postedByRole: 'resident' | 'admin';
  authorResidentId: string | null;
  createdAt: string;
}

interface NoticeState {
  notices: Notice[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (data: { title: string; body: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  getThread: (id: string) => Promise<{ notice: Notice; replies: NoticeReply[] }>;
  reply: (id: string, body: string) => Promise<NoticeReply>;
}

function mapNotice(raw: any): Notice {
  return {
    id: raw.id,
    category: raw.category,
    title: raw.title,
    body: raw.body,
    authorName: raw.author_name,
    authorUnit: raw.author_unit ?? null,
    postedByRole: raw.posted_by_role,
    isPinned: !!raw.is_pinned,
    authorResidentId: raw.author_resident_id ?? null,
    replyCount: typeof raw.reply_count === 'number' ? raw.reply_count : 0,
    createdAt: raw.created_at,
    lastActivityAt: raw.last_activity_at,
  };
}

function mapReply(raw: any): NoticeReply {
  return {
    id: raw.id,
    noticeId: raw.notice_id,
    body: raw.body,
    authorName: raw.author_name,
    authorUnit: raw.author_unit ?? null,
    postedByRole: raw.posted_by_role,
    authorResidentId: raw.author_resident_id ?? null,
    createdAt: raw.created_at,
  };
}

export const useNoticeStore = create<NoticeState>((set) => ({
  notices: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getNotices();
      const raw = res.data.data;
      set({ notices: Array.isArray(raw) ? raw.map(mapNotice) : [] });
    } finally {
      set({ loading: false });
    }
  },
  create: async (data) => {
    const res = await api.createNotice(data);
    const notice = mapNotice(res.data.data);
    set((s) => ({ notices: [notice, ...s.notices] }));
  },
  remove: async (id) => {
    await api.deleteNotice(id);
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },
  getThread: async (id) => {
    const res = await api.getNotice(id);
    const { notice, replies } = res.data.data;
    return { notice: mapNotice(notice), replies: Array.isArray(replies) ? replies.map(mapReply) : [] };
  },
  reply: async (id, body) => {
    const res = await api.replyToNotice(id, body);
    return mapReply(res.data.data);
  },
}));
