jest.mock('../api/client');

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import MyUnitScreen from './MyUnitScreen';
import * as api from '../api/client';
import { useUnitStore } from '../store/unitStore';

const profile = {
  unit: { unitNumber: 'A-204', floor: 2, wing: 'A', ownershipType: 'owner', communityName: 'Green Valley', verified: true },
  members: [],
  vehicles: [],
  pets: [],
  documents: [
    { id: 'd1', title: 'Sale Deed', category: 'ownership' },
    { id: 'd2', title: 'Maintenance Receipt', category: 'maintenance' },
  ],
  dues: { outstanding: 0, pendingCount: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  useUnitStore.setState({ profile, loading: false, error: false });
  (api.getResidentUnit as jest.Mock).mockResolvedValue({ data: { data: profile } });
  // FacilityBookingScreen's own effects, exercised only by the deep-link test.
  (api.getFacilities as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.getMyBookings as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.getFacilityAvailability as jest.Mock).mockResolvedValue({ data: { data: { slots: [] } } });
});

describe('MyUnitScreen documents grid', () => {
  it('shows document tiles and an add tile', async () => {
    const { getByText } = render(<MyUnitScreen />);
    await waitFor(() => expect(getByText('Sale Deed')).toBeTruthy());
    expect(getByText('Maintenance Receipt')).toBeTruthy();
    expect(getByText(/Add document/i)).toBeTruthy();
  });
});

describe('MyUnitScreen facility deep link', () => {
  it('opens facility booking directly when asked', async () => {
    const { getByText } = render(<MyUnitScreen initialOverlay="facilities" />);
    await waitFor(() => expect(getByText(/Book a court/i)).toBeTruthy());
  });
});
