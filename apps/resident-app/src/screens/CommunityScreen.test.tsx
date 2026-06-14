jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import CommunityScreen from './CommunityScreen';
const feed = {
  announcements: [{ id: 'a1', title: 'Water cut', body: '6pm', authorName: 'RWA', createdAt: '2026-06-12T10:00:00Z' }],
  issues: [{ id: 'i1', title: 'Lift broken', body: 'Block A', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-204', upvoteCount: 3, myUpvoted: false, createdAt: '2026-06-12T09:00:00Z' }],
  polls: [],
};
describe('CommunityScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  it('renders the feed and upvotes an issue', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: feed } });
    (api.upvoteIssue as jest.Mock).mockResolvedValue({ data: { data: { upvoted: true } } });
    const { getByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.press(getByText(/Same issue/));
    await waitFor(() => expect(api.upvoteIssue).toHaveBeenCalledWith('i1'));
  });
});
