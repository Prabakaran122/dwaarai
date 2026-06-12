jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import ParcelsScreen from './ParcelsScreen';

describe('ParcelsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists parcels and marks one collected', async () => {
    (api.getDeliveries as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 'd1', company: 'Amazon', note: 'Brown box', status: 'waiting', logged_by_name: 'Ramesh', created_at: '2026-06-12T08:00:00Z', resolved_at: null, image_url: null }] },
    });
    (api.collectDelivery as jest.Mock).mockResolvedValue({ data: { data: { id: 'd1', status: 'delivered' } } });

    const { getByText, queryByText } = render(<ParcelsScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('Amazon')).toBeTruthy());

    fireEvent.press(getByText('Mark collected'));
    await waitFor(() => expect(api.collectDelivery).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(queryByText('Amazon')).toBeNull());
  });

  it('renders company text when image_url is present in data', async () => {
    (api.getDeliveries as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 'd2', company: 'Flipkart', note: null, status: 'waiting', logged_by_name: 'Guard', created_at: '2026-06-12T09:00:00Z', resolved_at: null, image_url: '/uploads/parcels/2026-06/abc.jpg' }] },
    });

    const { getByText } = render(<ParcelsScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('Flipkart')).toBeTruthy());
  });
});
