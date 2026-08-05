import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CommunityScreen from './CommunityScreen';
import * as api from '../api/client';
import { useCommunityStore } from '../store/communityStore';

jest.mock('../api/client');

const feed = {
  posts: [
    { id: 'a1', type: 'announcement', title: 'Water cut', body: 'Tuesday', authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z' },
    { id: 'i1', type: 'issue', title: 'Lift broken', body: 'Stuck', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-704', upvoteCount: 3, myUpvoted: false, createdAt: '2026-08-03T09:00:00Z' },
    { id: 'd1', type: 'discussion', title: 'Parking talk', body: 'Thoughts?', authorName: 'Ravi', createdAt: '2026-07-30T09:00:00Z' },
  ],
  me: { isCommittee: false, committeeRole: null },
  announcements: [], issues: [], polls: [],
};

const committeeFeed = { ...feed, me: { isCommittee: true, committeeRole: 'Secretary' } };

beforeEach(() => {
  useCommunityStore.setState({ posts: [], me: null, loading: false, error: false, filter: 'all' });
  jest.clearAllMocks();
  (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: feed } });
  (api.upvoteIssue as jest.Mock).mockResolvedValue({ data: { data: { upvoted: true } } });
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [] } });
});

describe('CommunityScreen', () => {
  it('renders the unified feed with the announcement pinned first', async () => {
    const { getByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    expect(getByText('Water cut')).toBeTruthy();
    expect(getByText('Parking talk')).toBeTruthy();
  });

  it('upvotes an issue through the store', async () => {
    const { getByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.press(getByText(/Same issue/));
    await waitFor(() => expect(api.upvoteIssue).toHaveBeenCalledWith('i1'));
  });

  it('filters the feed to one type without refetching', async () => {
    const { getByText, queryByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.press(getByText('Discussions'));
    await waitFor(() => expect(queryByText('Lift broken')).toBeNull());
    expect(getByText('Parking talk')).toBeTruthy();
    expect(api.getCommunityFeed).toHaveBeenCalledTimes(1);
  });

  it('choosing Create poll in the compose sheet closes the sheet and opens the poll composer', async () => {
    useCommunityStore.setState({ posts: [], me: null, loading: false, error: false, filter: 'all' });
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: committeeFeed } });
    const { getByText, queryByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());

    fireEvent.press(getByText('Share something with your community…'));
    await waitFor(() => expect(getByText('Create poll')).toBeTruthy());
    fireEvent.press(getByText('Create poll'));

    await waitFor(() => expect(getByText('New poll')).toBeTruthy());
    expect(queryByText('Share something with your community…')).toBeNull();
    expect(queryByText('Report issue')).toBeNull();
  });
});
