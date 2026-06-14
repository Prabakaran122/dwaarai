import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import IssueCard from './IssueCard';

const issue = { id: 'i1', title: 'Lift broken', body: 'Block A lift stuck', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-204', upvoteCount: 3, myUpvoted: false, createdAt: '2026-06-12T09:00:00Z' };

describe('IssueCard', () => {
  it('renders title, status and upvote count, and fires onUpvote', () => {
    const onUpvote = jest.fn();
    const { getByText } = render(<IssueCard issue={issue} onUpvote={onUpvote} />);
    expect(getByText('Lift broken')).toBeTruthy();
    expect(getByText('Open')).toBeTruthy();
    expect(getByText(/Same issue/)).toBeTruthy();
    expect(getByText(/3/)).toBeTruthy();
    fireEvent.press(getByText(/Same issue/));
    expect(onUpvote).toHaveBeenCalledWith('i1');
  });
});
