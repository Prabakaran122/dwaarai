jest.mock('../api/client');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn(),
}));
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as api from '../api/client';
import * as ImagePicker from 'expo-image-picker';
import WalkInVisitorScreen from './WalkInVisitorScreen';
import { useAuthStore } from '../store/authStore';

// This suite renders a 3-step form with camera-permission/capture round trips
// per step; under CI's heavier load the default 5s timeout is too tight even
// though nothing here is actually slow logic (observed flaking in CI, not
// locally). Matches no other guard-app suite needing this, so scoped here.
//
// Raised 15s -> 45s after this went on flaking in CI. The number is not a
// measurement of how long the work takes — locally the slowest test here is
// ~180ms, an 80x margin at 15s — it is headroom against starvation. CI runs
// `pnpm -r run test`, which fans every workspace out in parallel, and the
// repo has grown two more Expo suites since the 15s fix; the runner simply
// does not schedule this suite's `waitFor` polls often enough.
//
// The real fix is to stop running the Expo suites concurrently with
// everything else in CI, not to keep raising a number. Until then this buys
// reliability at no cost when the machine is healthy: a passing test never
// waits, only a starved one does.
jest.setTimeout(45000);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useAuthStore.setState({ user: { name: 'Ramesh', role: 'guard', gateId: 'g1' }, isAuthenticated: true, isLoading: false });
  (ImagePicker.launchCameraAsync as jest.Mock)
    .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://id.jpg' }] })
    .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://face.jpg' }] })
    .mockResolvedValue({ canceled: false, assets: [{ uri: 'file://face.jpg' }] });
});
afterEach(() => { jest.useRealTimers(); });

async function fillStep1AndAdvance(getByText: (t: string | RegExp) => any, getByTestId: (t: string) => any) {
  fireEvent.changeText(getByTestId('visitor-name-input'), 'Rahul Sharma');
  fireEvent.changeText(getByTestId('visitor-mobile-input'), '9900011122');
  fireEvent.press(getByText('Aadhaar'));
  fireEvent.press(getByTestId('id-photo-button'));
  await waitFor(() => expect(getByText('Take face photo')).toBeTruthy());
  fireEvent.press(getByTestId('face-photo-button'));
  await waitFor(() => expect(getByTestId('step1-next')).toBeTruthy());
  fireEvent.press(getByTestId('step1-next'));
}

describe('WalkInVisitorScreen', () => {
  it('disables Next until name, mobile, ID type, ID photo, and face photo are all provided', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<WalkInVisitorScreen onClose={() => {}} />);
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.changeText(getByTestId('visitor-name-input'), 'Rahul Sharma');
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.changeText(getByTestId('visitor-mobile-input'), '9900011122');
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByText('Aadhaar'));
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByTestId('id-photo-button'));
    await waitFor(() => expect(getByText('Take face photo')).toBeTruthy());
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByTestId('face-photo-button'));
    await waitFor(() => expect(getByTestId('step1-next')).toBeTruthy());
  });

  it('searches units on step 2 and advances to the summary on selection', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({
      data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] },
    });
    const { getByText, getByTestId } = render(<WalkInVisitorScreen onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);

    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(api.lookupUnits).toHaveBeenCalledWith('A-204'));
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    await waitFor(() => expect(getByText('Send for approval')).toBeTruthy());
  });

  it('sends the visitor intake record on submit and shows awaiting-approval', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({
      data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] },
    });
    (api.createApproval as jest.Mock).mockResolvedValue({
      data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } },
    });
    const { getByText, getByTestId } = render(<WalkInVisitorScreen onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));

    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      unit_number: 'A-204',
      visitor_name: 'Rahul Sharma',
      visitor_mobile: '9900011122',
      id_type: 'aadhaar',
      gate_id: 'g1',
      photoUri: 'file://id.jpg',
      facePhotoUri: 'file://face.jpg',
    })));
    await waitFor(() => expect(getByText('Awaiting resident approval')).toBeTruthy());
  });

  it('shows the one-time entry pass code and validity window once the resident approves', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({ data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] } });
    (api.createApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } } });
    const validUntil = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    (api.getApproval as jest.Mock).mockResolvedValue({
      data: { data: { id: 'ap1', status: 'approved', responded_by_name: 'Asha Rao', visitor_pass: { otp: '482913', valid_until: validUntil } } },
    });

    const { getByText, getByTestId } = render(<WalkInVisitorScreen onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalled());

    await act(async () => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(getByText('Resident approved')).toBeTruthy());
    expect(getByText('482913')).toBeTruthy();
    expect(getByText(/transcription vendor|SMS/i)).toBeTruthy();
  });

  it('shows the phone fallback after 3 minutes of no response', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({ data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] } });
    (api.createApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } } });
    (api.getApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'expired' } } });

    const { getByText, getByTestId } = render(<WalkInVisitorScreen onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalled());

    await act(async () => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(getByText(/call the resident directly/i)).toBeTruthy());
    fireEvent.press(getByTestId('call-resident-button'));
  });
});
