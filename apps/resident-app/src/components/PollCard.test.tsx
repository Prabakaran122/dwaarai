import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PollCard from './PollCard';

const base = { id: 'p1', question: 'Paint colour?', status: 'open', closesAt: null, authorName: 'RWA', createdAt: '2026-06-12T08:00:00Z', totalVotes: 2, options: [{ id: 'o1', label: 'Blue', votes: 2 }, { id: 'o2', label: 'Green', votes: 0 }] };

describe('PollCard', () => {
  it('lets you vote when you have not voted', () => {
    const onVote = jest.fn();
    const { getByText } = render(<PollCard poll={{ ...base, myOptionId: null }} onVote={onVote} />);
    expect(getByText('Paint colour?')).toBeTruthy();
    fireEvent.press(getByText('Green'));
    expect(onVote).toHaveBeenCalledWith('p1', 'o2');
  });

  it('shows results once voted', () => {
    const { getByText } = render(<PollCard poll={{ ...base, myOptionId: 'o1' }} onVote={jest.fn()} />);
    expect(getByText(/100%/)).toBeTruthy(); // Blue 2/2
  });
});
