import { create } from 'zustand';
import * as api from '../api/client';

export interface Announcement { id: string; title: string; body: string; authorName: string; createdAt: string; }
export interface Issue { id: string; title: string; body: string; category: string; status: string; authorName: string; authorUnit: string | null; upvoteCount: number; myUpvoted: boolean; createdAt: string; }
export interface PollOption { id: string; label: string; votes: number | null; }
// Mirrors assemblePolls() in services/api-gateway/src/routes/polls.js — every
// field it puts on the wire, so the type stays a faithful description of the
// response rather than only the subset today's cards happen to read.
export interface Poll { id: string; topic?: string | null; question: string; status: string; closesAt: string | null; audience?: string; targetBlockId: string | null; oneVotePerUnit?: boolean; canManage: boolean; authorName: string; createdAt: string; totalVotes: number | null; myOptionId: string | null; showLiveResults?: boolean; isAnonymous?: boolean; options: PollOption[]; }
export interface Discussion { id: string; title: string; body: string; authorName: string; createdAt: string; }

export type PostType = 'announcement' | 'issue' | 'poll' | 'discussion';
export type FeedFilter = 'all' | PostType;

export type AnnouncementPost = Announcement & { type: 'announcement' };
export type IssuePost = Issue & { type: 'issue' };
export type PollPost = Poll & { type: 'poll' };
export type DiscussionPost = Discussion & { type: 'discussion' };
export type FeedPost = AnnouncementPost | IssuePost | PollPost | DiscussionPost;

export interface Me { isCommittee: boolean; committeeRole: string | null; }

interface CommunityState {
  posts: FeedPost[];
  me: Me | null;
  loading: boolean;
  error: boolean;
  filter: FeedFilter;
  fetch: () => Promise<void>;
  setFilter: (filter: FeedFilter) => void;
  visiblePosts: () => FeedPost[];
  toggleUpvote: (issueId: string) => Promise<void>;
  castVote: (pollId: string, optionId: string) => Promise<void>;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  posts: [],
  me: null,
  loading: false,
  error: false,
  filter: 'all',

  fetch: async () => {
    set({ loading: true, error: false });
    try {
      const res = await api.getCommunityFeed();
      const data = res.data.data;
      set({ posts: (data.posts ?? []) as FeedPost[], me: data.me ?? null });
    } catch {
      // Keep whatever is already on screen — a failed refresh should not blank
      // the feed someone is reading.
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },

  setFilter: (filter) => set({ filter }),

  // Filtering is client-side over data already held (BRD F-05), so switching a
  // tab is instant and costs no request. The server's ?type= filter exists for
  // callers that do not hold the feed.
  visiblePosts: () => {
    const { posts, filter } = get();
    return filter === 'all' ? posts : posts.filter((p) => p.type === filter);
  },

  toggleUpvote: async (issueId) => {
    const before = get().posts;
    const target = before.find((p) => p.id === issueId && p.type === 'issue') as IssuePost | undefined;
    if (!target) return;
    const next = !target.myUpvoted;

    set({
      posts: before.map((p) =>
        p.id === issueId && p.type === 'issue'
          ? { ...p, myUpvoted: next, upvoteCount: p.upvoteCount + (next ? 1 : -1) }
          : p
      ),
    });

    try {
      await api.upvoteIssue(issueId);
    } catch {
      // Revert only this issue's two fields, back onto whatever state is
      // current — not the whole captured array, and not an inverse delta.
      // Restoring the array would throw away a refresh that landed while the
      // request was in flight; an inverse delta applied to already-refreshed
      // state would decrement a count the server had already corrected.
      set({
        posts: get().posts.map((p) =>
          p.id === issueId && p.type === 'issue'
            ? { ...p, myUpvoted: target.myUpvoted, upvoteCount: target.upvoteCount }
            : p
        ),
      });
    }
  },

  castVote: async (pollId, optionId) => {
    try {
      await api.votePoll(pollId, optionId);
      await get().fetch();
    } catch {
      set({ error: true });
    }
  },
}));
