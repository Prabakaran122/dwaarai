jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import EventsScreen from './EventsScreen';
describe('EventsScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  it('lists events and RSVPs', async () => {
    (api.getEvents as jest.Mock).mockResolvedValue({ data: { data: [
      { id: 'e1', title: 'Holi Bash', description: null, location: 'Lawn', category: 'festival', startsAt: '2026-06-20T17:00:00Z', endsAt: null, authorName: 'RWA', goingCount: 5, myRsvp: null },
    ] } });
    (api.rsvpEvent as jest.Mock).mockResolvedValue({ data: { data: { eventId: 'e1', status: 'going' } } });
    const { getByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByText('Holi Bash')).toBeTruthy());
    fireEvent.press(getByText('Going'));
    await waitFor(() => expect(api.rsvpEvent).toHaveBeenCalledWith('e1', 'going'));
  });
});
