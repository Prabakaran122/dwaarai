import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CommunityStrip from './CommunityStrip';

describe('CommunityStrip', () => {
  it('renders a pinned notice when present', () => {
    const notice = { id: 'n1', title: 'Water cut 6pm', authorName: 'RWA', createdAt: '2026-06-12T10:00:00Z' };
    const { getByText } = render(<CommunityStrip pinnedNotice={notice} upcomingEvent={null} />);
    expect(getByText('Water cut 6pm')).toBeTruthy();
  });

  it('renders the empty notice state when none is pinned', () => {
    const { getByText } = render(<CommunityStrip pinnedNotice={null} upcomingEvent={null} />);
    expect(getByText('No announcements')).toBeTruthy();
    expect(getByText('Nothing scheduled yet')).toBeTruthy();
  });

  it('fires onNotice when the pinned notice is tapped', () => {
    const onNotice = jest.fn();
    const notice = { id: 'n1', title: 'Water cut 6pm', authorName: 'RWA', createdAt: '2026-06-12T10:00:00Z' };
    const { getByText } = render(<CommunityStrip pinnedNotice={notice} upcomingEvent={null} onNotice={onNotice} />);
    fireEvent.press(getByText('Water cut 6pm'));
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('shows the upcoming event title when present', () => {
    const ev = { id: 'e1', title: 'Holi Bash', location: 'Lawn', startsAt: '2026-06-20T17:00:00Z' };
    const { getByText } = render(<CommunityStrip pinnedNotice={null} upcomingEvent={ev} />);
    expect(getByText('Holi Bash')).toBeTruthy();
  });
});
