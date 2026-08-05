import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import IssueDetailScreen from './IssueDetailScreen';
import * as api from '../api/client';

jest.mock('../api/client');

const thread = {
  issue: {
    id: 'i1', title: 'Lift broken', body: 'Stuck on 7', category: 'maintenance', status: 'open',
    authorName: 'Asha', authorUnit: 'A-704', reference: 'IQ-2026-007',
    assigneeName: null, resolvedAt: null, upvoteCount: 24, myUpvoted: false,
    createdAt: '2026-08-01T09:00:00Z',
  },
  photos: [],
  timeline: [
    { from_status: null, to_status: 'open', changed_by_name: 'Asha', changed_by_role: null, kind: 'status_change', detail: 'Issue reported', created_at: '2026-08-01T09:00:00Z' },
  ],
  replies: [
    { id: 'rep1', author_name: 'Rajan Kumar', author_unit: 'B-201', author_role: 'Secretary', body: 'Technician booked', is_official: true, created_at: '2026-08-02T09:00:00Z' },
    { id: 'rep2', author_name: 'Ravi', author_unit: 'C-101', author_role: null, body: 'Same here', is_official: false, created_at: '2026-08-02T10:00:00Z' },
  ],
  upvoteCount: 24,
  myUpvoted: false,
  canChangeStatus: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.getIssue as jest.Mock).mockResolvedValue({ data: { data: thread } });
  (api.replyToIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'rep3', author_name: 'Asha', author_unit: 'A-704', author_role: null, body: 'Thanks', is_official: false, created_at: '2026-08-03T09:00:00Z' } } });
});

describe('IssueDetailScreen', () => {
  it('shows the reference and the impact counter', async () => {
    const { getByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('IQ-2026-007')).toBeTruthy());
    expect(getByText(/24 residents affected/)).toBeTruthy();
  });

  it('marks a committee reply as an official response and a resident reply not', async () => {
    const { getByText, queryAllByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Technician booked')).toBeTruthy());
    expect(getByText('Official response')).toBeTruthy();
    expect(queryAllByText('Official response')).toHaveLength(1);
  });

  it('hides the RWA action bar when the caller cannot change status', async () => {
    const { getByText, queryByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    expect(queryByText('Mark in progress')).toBeNull();
    expect(queryByText('Mark resolved')).toBeNull();
  });

  it('posts a reply and appends it', async () => {
    const { getByText, getByPlaceholderText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Write a reply…'), 'Thanks');
    fireEvent.press(getByText('Send'));
    await waitFor(() => expect(api.replyToIssue).toHaveBeenCalledWith('i1', 'Thanks'));
    await waitFor(() => expect(getByText('Thanks')).toBeTruthy());
  });

  it('surfaces a load failure instead of rendering an empty thread', async () => {
    (api.getIssue as jest.Mock).mockRejectedValue(new Error('offline'));
    const { getByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Could not load/)).toBeTruthy());
  });
});
