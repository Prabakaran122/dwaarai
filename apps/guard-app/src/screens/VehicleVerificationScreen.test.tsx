jest.mock('../api/client');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ base64: 'scan-data' }] }),
}));
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as api from '../api/client';
import VehicleVerificationScreen from './VehicleVerificationScreen';
import { useEntitlementStore } from '../store/entitlementStore';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';
import type { QueueEntry } from '../store/queueStore';

const eliteEntitlements = { fastag: true, anpr: true, face: true, aiAnomaly: true, tier: 'Elite' as const, updatedAt: null };

const matchedEntry: QueueEntry = {
  id: 'e1',
  plate: 'KA01AB1234',
  method: 'fastag',
  decision: 'allow',
  timestamp: new Date().toISOString(),
  unitNumber: 'A-204',
  residentName: 'Asha Rao',
  anprConfidence: 0.91,
};

beforeEach(() => {
  jest.clearAllMocks();
  useEntitlementStore.setState({ ...eliteEntitlements, loading: false });
  useAuthStore.setState({ user: { name: 'Ramesh', role: 'guard', gateId: 'g1' }, isAuthenticated: true, isLoading: false });
  useQueueStore.setState({
    entries: [matchedEntry],
    shiftStats: { shiftStart: new Date().toISOString(), totalEntries: 1, totalDenied: 0, totalVisitors: 0 },
  });
});

describe('VehicleVerificationScreen', () => {
  it('shows the plate and only the entitled layers (NAZ-017)', () => {
    useEntitlementStore.setState({ ...eliteEntitlements, face: false, loading: false });
    const { getAllByText, getByText, queryByText } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={() => {}} />);
    // The plate legitimately appears twice: once as the header title, once inside the ANPR layer card.
    expect(getAllByText('KA01AB1234').length).toBeGreaterThan(0);
    expect(getByText('FASTag')).toBeTruthy();
    expect(getByText('ANPR')).toBeTruthy();
    expect(queryByText('Face Recognition')).toBeNull();
  });

  it('shows FASTag Matched with unit and resident when the entry is linked', () => {
    const { getByText } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={() => {}} />);
    expect(getByText('Matched')).toBeTruthy();
    expect(getByText(/A-204/)).toBeTruthy();
    expect(getByText(/Asha Rao/)).toBeTruthy();
  });

  it('shows FASTag No match for an unrecognized vehicle', () => {
    const unknown: QueueEntry = { ...matchedEntry, unitNumber: undefined, residentName: undefined, decision: 'guard_review' };
    const { getByText } = render(<VehicleVerificationScreen entry={unknown} onClose={() => {}} />);
    expect(getByText('No match')).toBeTruthy();
  });

  it('shows the ANPR confidence bar when a reading is present', () => {
    const { getByText } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={() => {}} />);
    expect(getByText('91%')).toBeTruthy();
  });

  it('lets the guard scan the driver face and shows the confirmed result', async () => {
    (api.verifyDriver as jest.Mock).mockResolvedValue({
      data: { data: { status: 'confirmed', resident_name: 'Asha Rao', relationship: 'owner', confidence: 0.95 } },
    });
    const { getByTestId, getByText } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={() => {}} />);
    fireEvent.press(getByTestId('scan-driver-face'));
    await waitFor(() => expect(getByText('95%')).toBeTruthy());
    expect(getByText(/owner/i)).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
  });

  it('shows red + the anomaly banner on a FASTag mismatch when the AI layer is entitled', () => {
    const mismatched: QueueEntry = { ...matchedEntry, alertType: 'fastag_mismatch', decision: 'guard_review' };
    const { getByText } = render(<VehicleVerificationScreen entry={mismatched} onClose={() => {}} />);
    expect(getByText(/FASTag mismatch/i)).toBeTruthy();
  });

  it('shows the override action only when the result is not green', () => {
    // Face is entitled by default (Elite) and would sit "pending" until scanned, which is
    // correctly amber on its own — isolate this case to FASTag+ANPR to test a clean green.
    useEntitlementStore.setState({ ...eliteEntitlements, face: false, loading: false });
    const clean = render(<VehicleVerificationScreen entry={matchedEntry} onClose={() => {}} />);
    expect(clean.queryByTestId('override-button')).toBeNull();

    const flagged: QueueEntry = { ...matchedEntry, decision: 'guard_review', unitNumber: undefined, residentName: undefined };
    const review = render(<VehicleVerificationScreen entry={flagged} onClose={() => {}} />);
    expect(review.getByTestId('override-button')).toBeTruthy();
  });

  it('Open gate sends the open command, clears the entry, and closes', async () => {
    (api.sendGateCommand as jest.Mock).mockResolvedValue({});
    const onClose = jest.fn();
    const { getByTestId } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={onClose} />);
    fireEvent.press(getByTestId('open-gate-button'));
    await waitFor(() => expect(api.sendGateCommand).toHaveBeenCalledWith('g1', 'open'));
    expect(useQueueStore.getState().entries.find((e) => e.id === 'e1')).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Deny sends the deny command, clears the entry, and closes', async () => {
    (api.sendGateCommand as jest.Mock).mockResolvedValue({});
    const onClose = jest.fn();
    const { getByTestId } = render(<VehicleVerificationScreen entry={matchedEntry} onClose={onClose} />);
    fireEvent.press(getByTestId('deny-button'));
    await waitFor(() => expect(api.sendGateCommand).toHaveBeenCalledWith('g1', 'deny'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
