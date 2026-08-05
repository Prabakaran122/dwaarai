jest.mock('../api/client');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
}));
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import * as apiClient from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import VehiclesScreen from './VehiclesScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('VehiclesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Seed getVehicles to resolve empty so the store fetch doesn't throw.
    mockClient.getVehicles.mockResolvedValue({ data: { data: [] } } as any);
    // Reset store to empty state before each test.
    useVehicleStore.setState({ vehicles: [], loading: false } as any);
  });

  it('renders the Vehicles title in the AppBar', () => {
    const { getByText } = render(<VehiclesScreen onClose={() => {}} />);
    expect(getByText('Vehicles')).toBeTruthy();
  });

  it('renders the FAB (add vehicle affordance)', () => {
    const { UNSAFE_getAllByType } = render(<VehiclesScreen onClose={() => {}} />);
    const { TouchableOpacity } = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders the empty-state copy when vehicles list is empty', () => {
    const { getByText } = render(<VehiclesScreen onClose={() => {}} />);
    expect(getByText('No vehicles registered')).toBeTruthy();
  });

  it('renders without onClose (standalone route) without crashing', () => {
    const { getByText } = render(<VehiclesScreen />);
    expect(getByText('Vehicles')).toBeTruthy();
  });

  it('shows a "How to link FASTag" affordance for a vehicle with no FASTag linked', () => {
    useVehicleStore.setState({
      vehicles: [{ id: 'v1', plate: 'KA01AB1234', make: '', model: '', type: 'car', createdAt: '' } as any],
      loading: false,
    } as any);
    const { getByText } = render(<VehiclesScreen onClose={() => {}} />);
    expect(getByText(/How to link FASTag/i)).toBeTruthy();
  });

  it('does not show the affordance for a vehicle that already has a FASTag linked', () => {
    useVehicleStore.setState({
      vehicles: [{ id: 'v1', plate: 'KA01AB1234', make: '', model: '', type: 'car', fastagTidHash: 'abc123', createdAt: '' } as any],
      loading: false,
    } as any);
    const { queryByText } = render(<VehiclesScreen onClose={() => {}} />);
    expect(queryByText(/How to link FASTag/i)).toBeNull();
  });

  it('explains that FASTag links automatically, not manually, when tapped', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useVehicleStore.setState({
      vehicles: [{ id: 'v1', plate: 'KA01AB1234', make: '', model: '', type: 'car', createdAt: '' } as any],
      loading: false,
    } as any);
    const { getByText } = render(<VehiclesScreen onClose={() => {}} />);
    fireEvent.press(getByText(/How to link FASTag/i));
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringMatching(/FASTag/i),
      expect.stringMatching(/automatic|drive|gate/i),
    );
  });
});
