jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import GateHomeScreen from './GateHomeScreen';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';
import { useSosStore } from '../store/sosStore';
import { useHandoverStore } from '../store/handoverStore';

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
  useHandoverStore.setState({ latest: null, openItems: { sosActive: 0, deliveriesWaiting: 0 } });
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

  it('shows the previous guard’s handover note (NAZ-068)', () => {
    useHandoverStore.setState({
      latest: { note: 'Watch for the plumber van after 6pm', guardName: 'Suresh', createdAt: new Date().toISOString() },
      openItems: { sosActive: 0, deliveriesWaiting: 0 },
    });
    const { getByText } = render(<GateHomeScreen onNavigate={() => {}} />);
    expect(getByText(/Watch for the plumber van/)).toBeTruthy();
  });

  it('opens a handover-note prompt before logging out, and skip logs out without one', () => {
    const logout = jest.fn();
    useAuthStore.setState({ user: baseUser, isAuthenticated: true, isLoading: false, logout });
    const { getByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('logout-button'));
    expect(logout).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('skip-logout-button'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('submits the handover note before logging out (NAZ-068)', async () => {
    const logout = jest.fn();
    const submit = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ user: baseUser, isAuthenticated: true, isLoading: false, logout });
    useHandoverStore.setState({ latest: null, openItems: { sosActive: 0, deliveriesWaiting: 0 }, submit });
    const { getByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('logout-button'));
    fireEvent.changeText(getByTestId('handover-note-input'), 'Gate 2 light is out');
    fireEvent.press(getByTestId('end-shift-button'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('Gate 2 light is out'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('opens the verification screen for the alert entry when its banner is tapped, and back returns home', () => {
    useQueueStore.setState({
      entries: [{
        id: 'e1', plate: 'KA01AB1234', method: 'fastag' as const, decision: 'guard_review' as const,
        timestamp: new Date().toISOString(), unitNumber: 'A-204', residentName: 'Asha Rao',
      }],
      shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 1, totalDenied: 0, totalVisitors: 0 },
    });
    const { getByTestId, getByText, queryByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('alert-banner'));
    expect(getByTestId('open-gate-button')).toBeTruthy();

    fireEvent.press(getByTestId('back-button'));
    expect(queryByTestId('open-gate-button')).toBeNull();
    expect(getByText('Vehicle approaching')).toBeTruthy();
  });

  it('opens the mandatory new-vehicle-entry intake for a completely unmatched plate (BRD §5.3)', () => {
    useQueueStore.setState({
      entries: [{
        id: 'e1', plate: 'KA07ZZ9999', method: 'anpr' as const, decision: 'guard_review' as const,
        timestamp: new Date().toISOString(),
      }],
      shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 1, totalDenied: 0, totalVisitors: 0 },
    });
    const { getByTestId, getByText, queryByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('alert-banner'));
    // The intake screen, not the verification screen, for a plate with no unit/resident match at all.
    expect(queryByTestId('open-gate-button')).toBeNull();
    expect(getByText(/Plate not found in registry/i)).toBeTruthy();
    expect(getByTestId('take-photo-button')).toBeTruthy();
  });

  it('opens the new-vehicle-entry intake manually via the Vehicle entry quick action', () => {
    const { getByTestId } = render(<GateHomeScreen onNavigate={() => {}} />);
    fireEvent.press(getByTestId('quick-action-vehicle'));
    expect(getByTestId('plate-input')).toBeTruthy();
  });
});
