jest.mock('../api/client');
import * as api from '../api/client';
import { useCommunityStore } from './communityStore';

const sample = {
  announcements: [{ id: 'a1', title: 'Water cut', body: '6pm today', authorName: 'RWA', createdAt: '2026-06-12T10:00:00Z' }],
  issues: [{ id: 'i1', title: 'Lift broken', body: 'Block A lift', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-204', upvoteCount: 3, myUpvoted: false, createdAt: '2026-06-12T09:00:00Z' }],
  polls: [{ id: 'p1', question: 'Paint colour?', status: 'open', closesAt: null, targetBlockId: null, canManage: false, authorName: 'RWA', createdAt: '2026-06-12T08:00:00Z', totalVotes: 2, myOptionId: null, options: [{ id: 'o1', label: 'Blue', votes: 2 }, { id: 'o2', label: 'Green', votes: 0 }] }],
};

beforeEach(() => { useCommunityStore.setState({ feed: null, loading: false, error: false }); jest.clearAllMocks(); });

describe('communityStore', () => {
  it('populates feed on success', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().feed?.issues[0].upvoteCount).toBe(3);
    expect(useCommunityStore.getState().error).toBe(false);
  });

  it('sets error and preserves feed on failure', async () => {
    useCommunityStore.setState({ feed: sample });
    (api.getCommunityFeed as jest.Mock).mockRejectedValue(new Error('x'));
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().error).toBe(true);
    expect(useCommunityStore.getState().feed).toEqual(sample);
  });

  it('toggleUpvote optimistically flips count + flag', () => {
    useCommunityStore.setState({ feed: sample });
    useCommunityStore.getState().applyUpvote('i1', true);
    const i = useCommunityStore.getState().feed!.issues[0];
    expect(i.myUpvoted).toBe(true);
    expect(i.upvoteCount).toBe(4);
  });
});
