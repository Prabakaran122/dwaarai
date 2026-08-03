jest.mock('../api/client');
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GateHomeScreen from './GateHomeScreen';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';
import { useSosStore } from '../store/sosStore';

const baseUser = {
  name: 'Ramesh',
  role: 'guard',
  gateId: 'g1',
  gateName: 'Main Gate',
  communityName: 'Palm Meadows',
};

beforeEach(() => {
  useAuthStore.setState({ user: baseUser, isAuthenticated: true, isLoading: false });
  useQueueStore.setState({
    entries: [],
    shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 0, totalDenied: 0, totalVisitors: 0 },
  });
  useSosStore.setState({ active: [], raising: false });
});

describe('GateHomeScreen', () => {
  it('renders the guard, gate, and society name in the header', () => {
    const { getByText } = render(<GateHomeScreen onNavigate={() => {}} />);
    expect(getByText('Ramesh')).toBeTruthy();
    expect(getByText('Main Gate')).toBeTruthy();
    expect(getByText('Palm Meadows')).toBeTruthy();
  });

  it('shows no alert banner when nothing is pending', () => {
    const { queryByText } = render(<GateHomeScreen onNavigate={() => {}} />);
    expect(queryByText('Vehicle approaching')).toBeNull();
  });

  it('shows the alert banner for the highest-priority pending entry', () => {
    useQueueStore.setState({
      entries: [
        {
          id: 'e1',
          plate: 'KA01AB1234',
          method: 'fastag',
          decision: 'guard_review',
          timestamp: new Date().toISOString(),
          unitNumber: 'A-204',
          residentName: 'Asha Rao',
        },
      ],
      shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 1, totalDenied: 0, totalVisitors: 0 },
    });
    const { getByText, getAllByText } = render(<GateHomeScreen onNavigate={() => {}} />);
    expect(getByText('Vehicle approaching')).toBeTruthy();
    // The plate legitimately appears twice: once in the alert banner, once in the live feed below it.
    expect(getAllByText('KA01AB1234').length).toBeGreaterThan(0);
  });

  it('quick actions call onNavigate with the right tab', () => {
    const onNavigate = jest.fn();
    const { getByTestId } = render(<GateHomeScreen onNavigate={onNavigate} />);
    fireEvent.press(getByTestId('quick-action-visitor'));
    expect(onNavigate).toHaveBeenCalledWith('visitors');
    fireEvent.press(getByTestId('quick-action-delivery'));
    expect(onNavigate).toHaveBeenCalledWith('parcels');
    fireEvent.press(getByTestId('quick-action-incident'));
    expect(onNavigate).toHaveBeenCalledWith('incident');
  });

  it('shows the active SOS banner when one is raised', () => {
    useSosStore.setState({
      active: [{ id: 's1', type: 'security', note: null, gateId: 'g1', raisedByName: 'Ramesh', createdAt: new Date().toISOString() }],
      raising: false,
    });
    const { getByText } = render(<GateHomeScreen onNavigate={() => {}} />);
    expect(getByText(/EMERGENCY ACTIVE/i)).toBeTruthy();
  });

  it('logs out when the header logout icon is pressed', () => {
    const logout = jest.fn();
    useAuthStore.setState({ user: baseUser, isAuthenticated: true, isLoading: false, logout });
    const { getByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('logout-button'));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
