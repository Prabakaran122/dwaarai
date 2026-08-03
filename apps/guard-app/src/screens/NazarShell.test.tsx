import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import NazarShell from './NazarShell';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';

beforeEach(() => {
  useAuthStore.setState({ user: { name: 'Ramesh', role: 'guard', gateId: 'g1' }, isAuthenticated: true, isLoading: false });
  useQueueStore.setState({
    entries: [],
    shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 0, totalDenied: 0, totalVisitors: 0 },
  });
});

describe('NazarShell', () => {
  it('shows Gate Home by default and switches to the real Visitors screen, not a placeholder', () => {
    const { getByText, getByTestId, queryByText } = render(<NazarShell />);
    expect(getByText('Ramesh')).toBeTruthy();

    fireEvent.press(getByTestId('tab-visitors'));
    expect(getByText('Visitor mobile number')).toBeTruthy();
    expect(queryByText('Coming in this redesign')).toBeNull();
    expect(queryByText('Ramesh')).toBeNull();
  });

  it('shows the real Parcels screen, not a placeholder', () => {
    const { getByTestId, getByText, queryByText } = render(<NazarShell />);
    fireEvent.press(getByTestId('tab-parcels'));
    expect(getByText('Log Delivery')).toBeTruthy();
    expect(queryByText('Coming in this redesign')).toBeNull();
  });
});
