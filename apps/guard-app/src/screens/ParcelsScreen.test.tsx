jest.mock('../api/client');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file://parcel.jpg' }] }),
}));
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import ParcelsScreen from './ParcelsScreen';
import { useDeliveryStore } from '../store/deliveryStore';

const freshDelivery = { id: 'd1', company: 'Amazon', note: null, status: 'waiting' as const, unitNumber: 'A-204', createdAt: new Date().toISOString() };
const overstayedDelivery = { id: 'd2', company: 'Zomato', note: null, status: 'waiting' as const, unitNumber: 'B-101', createdAt: new Date(Date.now() - 20 * 60_000).toISOString() };

beforeEach(() => {
  jest.clearAllMocks();
  useDeliveryStore.setState({ active: [freshDelivery, overstayedDelivery], logging: false });
});

describe('ParcelsScreen', () => {
  it('shows an overstay chip only for deliveries waiting more than 15 minutes (NAZ-045)', () => {
    const { getByTestId, queryByTestId } = render(<ParcelsScreen />);
    expect(queryByTestId('overstay-chip-d1')).toBeNull();
    expect(getByTestId('overstay-chip-d2')).toBeTruthy();
  });

  it('offers exactly the BRD source list when logging a new delivery (NAZ-046)', () => {
    const { getByText } = render(<ParcelsScreen />);
    fireEvent.press(getByText('Log Delivery'));
    for (const source of ['Zomato', 'Swiggy', 'Zepto', 'Blinkit', 'Flipkart', 'Amazon', 'Other']) {
      expect(getByText(source)).toBeTruthy();
    }
  });

  it('logs a new delivery with source, unit, and photo', async () => {
    (api.logDelivery as jest.Mock).mockResolvedValue({ data: { data: { id: 'd3', company: 'Zepto', unit_number: 'C-303', status: 'waiting', created_at: new Date().toISOString() } } });
    const { getByText, getByTestId } = render(<ParcelsScreen />);
    fireEvent.press(getByText('Log Delivery'));
    fireEvent.press(getByText('Zepto'));
    fireEvent.changeText(getByTestId('delivery-unit-input'), 'C-303');
    fireEvent.press(getByTestId('delivery-photo-button'));
    await waitFor(() => expect(getByTestId('delivery-photo-button')).toBeTruthy());
    fireEvent.press(getByText('Send'));
    await waitFor(() => expect(api.logDelivery).toHaveBeenCalledWith('C-303', 'Zepto', undefined, 'file://parcel.jpg'));
  });

  it('marks a parcel collected with a single confirm tap', async () => {
    (api.updateDeliveryStatus as jest.Mock).mockResolvedValue({});
    const { getByTestId } = render(<ParcelsScreen />);
    fireEvent.press(getByTestId('mark-collected-d1'));
    await waitFor(() => expect(api.updateDeliveryStatus).toHaveBeenCalledWith('d1', 'delivered'));
  });
});
