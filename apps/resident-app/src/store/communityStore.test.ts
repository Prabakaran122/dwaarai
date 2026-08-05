import { useCommunityStore } from './communityStore';
import * as api from '../api/client';

jest.mock('../api/client');

const post = (id: string, type: string, iso: string, extra: object = {}) =>
  ({ id, type, createdAt: iso, ...extra });

const sample = {
  posts: [
    post('a1', 'announcement', '2026-08-01T09:00:00Z', { title: 'Water cut', body: 'Tuesday', authorName: 'RWA' }),
    post('i1', 'issue', '2026-08-03T09:00:00Z', { title: 'Lift broken', body: 'Stuck', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-704', upvoteCount: 3, myUpvoted: false }),
    post('p1', 'poll', '2026-08-02T09:00:00Z', { question: 'Gym hours?', status: 'open', options: [{ id: 'o1', label: '6am', votes: 2 }], totalVotes: 2, myOptionId: null, canManage: false }),
    post('d1', 'discussion', '2026-07-30T09:00:00Z', { title: 'Parking', body: 'Thoughts?', authorName: 'Ravi' }),
  ],
  me: { isCommittee: false, committeeRole: null },
  announcements: [], issues: [], polls: [],
};

beforeEach(() => {
  useCommunityStore.setState({ posts: [], me: null, loading: false, error: false, filter: 'all' });
  jest.clearAllMocks();
});

describe('communityStore', () => {
  it('loads posts and the caller capability', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().posts).toHaveLength(4);
    expect(useCommunityStore.getState().me).toEqual({ isCommittee: false, committeeRole: null });
    expect(useCommunityStore.getState().error).toBe(false);
  });

  it('flags an error without discarding what it already had', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.getCommunityFeed as jest.Mock).mockRejectedValue(new Error('offline'));
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().error).toBe(true);
    expect(useCommunityStore.getState().posts).toHaveLength(4);
  });

  it('filters by type without refetching', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    useCommunityStore.getState().setFilter('issue');
    expect(useCommunityStore.getState().visiblePosts().map((p) => p.id)).toEqual(['i1']);
    expect(api.getCommunityFeed).toHaveBeenCalledTimes(1);
  });

  it('applies an upvote immediately and keeps it when the server agrees', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.upvoteIssue as jest.Mock).mockResolvedValue({ data: { data: { upvoted: true } } });

    await useCommunityStore.getState().toggleUpvote('i1');

    const issue: any = useCommunityStore.getState().posts.find((p) => p.id === 'i1');
    expect(issue.myUpvoted).toBe(true);
    expect(issue.upvoteCount).toBe(4);
  });

  it('reverts the upvote when the server rejects it', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.upvoteIssue as jest.Mock).mockRejectedValue(new Error('500'));

    await useCommunityStore.getState().toggleUpvote('i1');

    const issue: any = useCommunityStore.getState().posts.find((p) => p.id === 'i1');
    expect(issue.myUpvoted).toBe(false);
    expect(issue.upvoteCount).toBe(3);
  });
});
