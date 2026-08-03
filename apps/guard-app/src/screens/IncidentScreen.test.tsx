jest.mock('../api/client');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file://incident.jpg' }] }),
}));
jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Recording: jest.fn().mockImplementation(() => ({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      startAsync: jest.fn().mockResolvedValue(undefined),
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue('file://incident.m4a'),
    })),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as api from '../api/client';
import IncidentScreen from './IncidentScreen';
import { useAuthStore } from '../store/authStore';

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: { name: 'Ramesh', role: 'guard', gateId: 'g1' }, isAuthenticated: true, isLoading: false });
});

describe('IncidentScreen', () => {
  it('renders all BRD incident types', () => {
    const { getByText } = render(<IncidentScreen />);
    ['Speeding vehicle', 'Unauthorized entry', 'Theft attempt', 'Medical emergency', 'Fight', 'Property damage', 'Other'].forEach((label) => {
      expect(getByText(label)).toBeTruthy();
    });
  });

  it('disables submit until a type is picked and details reach 20 characters', () => {
    const { getByText, getByTestId } = render(<IncidentScreen />);
    expect(getByTestId('submit-incident-button').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(getByText('Fight'));
    fireEvent.changeText(getByTestId('incident-details-input'), 'too short');
    expect(getByTestId('submit-incident-button').props.accessibilityState?.disabled).toBe(true);
    expect(getByText('Details must be at least 20 characters')).toBeTruthy();

    fireEvent.changeText(getByTestId('incident-details-input'), 'Two residents were arguing loudly near the gate');
    expect(getByTestId('submit-incident-button').props.accessibilityState?.disabled).toBe(false);
  });

  it('submits the incident with type, description, and gateId', async () => {
    (api.createIncident as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
    const { getByText, getByTestId } = render(<IncidentScreen />);
    fireEvent.press(getByText('Theft attempt'));
    fireEvent.changeText(getByTestId('incident-details-input'), 'Someone tried to remove a bicycle from the rack');
    fireEvent.press(getByTestId('submit-incident-button'));

    await waitFor(() => expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'theft_attempt',
      description: 'Someone tried to remove a bicycle from the rack',
      gateId: 'g1',
    })));
    await waitFor(() => expect(getByText('Incident Logged')).toBeTruthy());
  });

  it('attaches a captured photo to the submission', async () => {
    (api.createIncident as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
    const { getByText, getByTestId } = render(<IncidentScreen />);
    fireEvent.press(getByText('Fight'));
    fireEvent.changeText(getByTestId('incident-details-input'), 'Two residents were arguing loudly near the gate');
    fireEvent.press(getByTestId('incident-photo-button'));
    await waitFor(() => expect(getByText('Retake photo')).toBeTruthy());
    fireEvent.press(getByTestId('submit-incident-button'));

    await waitFor(() => expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      photoUri: 'file://incident.jpg',
    })));
  });

  it('records a voice note, attaches it, and shows the transcription-pending notice instead of fabricating text', async () => {
    (api.createIncident as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
    const { getByText, getByTestId, queryByText } = render(<IncidentScreen />);
    expect(queryByText(/transcription vendor not yet selected/i)).toBeNull();

    await act(async () => { fireEvent.press(getByTestId('record-voice-button')); });
    await waitFor(() => expect(getByText('Stop recording')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('record-voice-button')); });
    await waitFor(() => expect(getByText(/transcription vendor not yet selected/i)).toBeTruthy());

    fireEvent.press(getByText('Fight'));
    fireEvent.changeText(getByTestId('incident-details-input'), 'Two residents were arguing loudly near the gate');
    fireEvent.press(getByTestId('submit-incident-button'));

    await waitFor(() => expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      audioUri: 'file://incident.m4a',
    })));
  });
});
