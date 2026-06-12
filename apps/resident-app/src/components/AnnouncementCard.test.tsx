import React from 'react';
import { render } from '@testing-library/react-native';
import AnnouncementCard from './AnnouncementCard';

const announcement = {
  id: 'a1',
  title: 'Water cut',
  body: '6pm today',
  authorName: 'RWA',
  createdAt: '2026-06-12T10:00:00Z',
};

describe('AnnouncementCard', () => {
  it('renders the announcement title', () => {
    const { getByText } = render(<AnnouncementCard announcement={announcement} />);
    expect(getByText('Water cut')).toBeTruthy();
  });

  it('renders body and pinned-by author', () => {
    const { getByText } = render(<AnnouncementCard announcement={announcement} />);
    expect(getByText('6pm today')).toBeTruthy();
    expect(getByText('Pinned by RWA')).toBeTruthy();
  });
});
