jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import FacilityBookingScreen from './FacilityBookingScreen';

describe('FacilityBookingScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  it('shows slots and books an open one', async () => {
    (api.getFacilities as jest.Mock).mockResolvedValue({ data: { data: [
      { id: 'f1', name: 'Badminton Court', sport: 'badminton', openTime: '06:00:00', closeTime: '08:00:00', slotMinutes: 60 },
    ] } });
    (api.getFacilityAvailability as jest.Mock).mockResolvedValue({ data: { data: { facility: { id: 'f1', name: 'Badminton Court', sport: 'badminton', slotMinutes: 60 }, date: '2026-06-13', slots: [
      { start: '06:00', end: '07:00', status: 'open' },
      { start: '07:00', end: '08:00', status: 'booked' },
    ] } } });
    (api.bookFacility as jest.Mock).mockResolvedValue({ data: { data: { id: 'b1', status: 'booked' } } });
    (api.getMyBookings as jest.Mock).mockResolvedValue({ data: { data: [] } });

    const { getByText } = render(<FacilityBookingScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('06:00')).toBeTruthy());
    fireEvent.press(getByText('06:00'));
    fireEvent.press(getByText('Book selected slot'));
    await waitFor(() => expect(api.bookFacility).toHaveBeenCalledWith('f1', expect.objectContaining({ start: '06:00' })));
  });
});
