import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PollCard from './PollCard';


const base = { id: 'p1', question: 'Paint colour?', status: 'open', closesAt: null, targetBlockId: null, canManage: false, authorName: 'RWA', createdAt: '2026-06-12T08:00:00Z', totalVotes: 2, options: [{ id: 'o1', label: 'Blue', votes: 2 }, { id: 'o2', label: 'Green', votes: 0 }] };

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

  it('shows a Close action for a manager on an open poll', () => {
    const onClose = jest.fn();
    const { getByText } = render(<PollCard poll={{ ...base, myOptionId: null, canManage: true }} onVote={jest.fn()} onClose={onClose} />);
    fireEvent.press(getByText('Close poll'));
    expect(onClose).toHaveBeenCalledWith('p1');
  });

  it('says results are hidden rather than showing zero when the poll hides them', () => {
    const poll: any = {
      id: 'p1', question: 'Gym hours?', status: 'open', closesAt: null, targetBlockId: null,
      canManage: false, authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z',
      totalVotes: null, myOptionId: 'o1', showLiveResults: false,
      options: [{ id: 'o1', label: '6am', votes: null }, { id: 'o2', label: '7am', votes: null }],
    };
    const { getByText, queryByText } = render(<PollCard poll={poll} onVote={() => {}} />);
    expect(getByText(/Results hidden until the poll closes/)).toBeTruthy();
    expect(queryByText('0%')).toBeNull();
  });

  it('shows percentages once results are visible', () => {
    const poll: any = {
      id: 'p2', question: 'Gym hours?', status: 'open', closesAt: null, targetBlockId: null,
      canManage: false, authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z',
      totalVotes: 4, myOptionId: 'o1', showLiveResults: true,
      options: [{ id: 'o1', label: '6am', votes: 3 }, { id: 'o2', label: '7am', votes: 1 }],
    };
    const { getByText } = render(<PollCard poll={poll} onVote={() => {}} />);
    expect(getByText('75%')).toBeTruthy();
    expect(getByText('25%')).toBeTruthy();
  });
});
