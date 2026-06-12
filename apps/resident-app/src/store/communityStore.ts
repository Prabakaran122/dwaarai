import { create } from 'zustand';
import * as api from '../api/client';

export interface Announcement { id: string; title: string; body: string; authorName: string; createdAt: string; }
export interface Issue { id: string; title: string; body: string; category: string; status: string; authorName: string; authorUnit: string | null; upvoteCount: number; myUpvoted: boolean; createdAt: string; }
export interface PollOption { id: string; label: string; votes: number; }
export interface Poll { id: string; question: string; status: string; closesAt: string | null; authorName: string; createdAt: string; totalVotes: number; myOptionId: string | null; options: PollOption[]; }
export interface CommunityFeed { announcements: Announcement[]; issues: Issue[]; polls: Poll[]; }

interface CommunityState {
  feed: CommunityFeed | null;
  loading: boolean;
  error: boolean;
  fetch: () => Promise<void>;
  applyUpvote: (issueId: string, upvoted: boolean) => void;
}

export const useCommunityStore = create<CommunityState>((set) => ({
  feed: null,
  loading: false,
  error: false,
  fetch: async () => {
    set({ loading: true, error: false });
    try { const res = await api.getCommunityFeed(); set({ feed: res.data.data as CommunityFeed }); }
    catch { set({ error: true }); }
    finally { set({ loading: false }); }
  },
  applyUpvote: (issueId, upvoted) => set((s) => {
    if (!s.feed) return s;
    return {
      feed: {
        ...s.feed,
        issues: s.feed.issues.map((i) => i.id === issueId ? { ...i, myUpvoted: upvoted, upvoteCount: i.upvoteCount + (upvoted ? 1 : -1) } : i),
      },
    };
  }),
}));
