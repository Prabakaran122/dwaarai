import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CommunityScreen, { matchesTerm } from './CommunityScreen';
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
  (api.getTrending as jest.Mock).mockResolvedValue({ data: { data: [] } });
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

describe('matchesTerm (F-06 trending chips)', () => {
  it('F-06: matches a term in the title', () => {
    expect(matchesTerm({ title: 'Water outage Thursday' }, 'water')).toBe(true);
  });

  it('F-06: matches a poll question, not just a title', () => {
    expect(matchesTerm({ question: 'Should the water tank be cleaned?' }, 'water')).toBe(true);
  });

  it('F-06: matches the body too', () => {
    expect(matchesTerm({ title: 'Notice', body: 'The lift is down' }, 'lift')).toBe(true);
  });

  it('F-06: is case-insensitive', () => {
    expect(matchesTerm({ title: 'WATER cut' }, 'water')).toBe(true);
  });

  it('F-06: excludes posts that do not mention the term', () => {
    expect(matchesTerm({ title: 'Gym timings' }, 'water')).toBe(false);
  });

  it('F-06: tolerates a post with no text fields at all', () => {
    expect(matchesTerm({}, 'water')).toBe(false);
  });
});
