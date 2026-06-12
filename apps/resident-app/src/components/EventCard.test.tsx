import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import EventCard from './EventCard';
const ev = { id: 'e1', title: 'Holi Bash', description: 'Colours at the lawn', location: 'Clubhouse', category: 'festival', startsAt: '2026-06-20T17:00:00Z', endsAt: null, authorName: 'RWA', goingCount: 12, myRsvp: null };
describe('EventCard', () => {
  it('renders title, location, going count and fires onRsvp', () => {
    const onRsvp = jest.fn();
    const { getByText } = render(<EventCard event={ev} onRsvp={onRsvp} />);
    expect(getByText('Holi Bash')).toBeTruthy();
    expect(getByText(/Clubhouse/)).toBeTruthy();
    expect(getByText(/12 going/)).toBeTruthy();
    fireEvent.press(getByText('Going'));
    expect(onRsvp).toHaveBeenCalledWith('e1', 'going');
  });
});
