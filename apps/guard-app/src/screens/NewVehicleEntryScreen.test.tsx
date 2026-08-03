jest.mock('../api/client');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file://vehicle.jpg' }] }),
}));
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as api from '../api/client';
import NewVehicleEntryScreen from './NewVehicleEntryScreen';
import { useAuthStore } from '../store/authStore';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useAuthStore.setState({ user: { name: 'Ramesh', role: 'guard', gateId: 'g1' }, isAuthenticated: true, isLoading: false });
});
afterEach(() => { jest.useRealTimers(); });

async function fillStep1AndAdvance(getByText: (t: string | RegExp) => any, getByTestId: (t: string) => any) {
  fireEvent.press(getByText('Car/SUV'));
  fireEvent.press(getByText('Delivery'));
  fireEvent.press(getByTestId('take-photo-button'));
  await waitFor(() => expect(getByTestId('step1-next')).toBeTruthy());
  fireEvent.press(getByTestId('step1-next'));
}

describe('NewVehicleEntryScreen', () => {
  it('shows the plate-not-found warning and a locked, pre-filled plate for an ANPR-detected entry', () => {
    const { getByText } = render(
      <NewVehicleEntryScreen
        entry={{ id: 'e1', plate: 'KA07ZZ9999', method: 'anpr', decision: 'guard_review', timestamp: new Date().toISOString() }}
        onClose={() => {}}
      />
    );
    expect(getByText(/Plate not found in registry/i)).toBeTruthy();
    expect(getByText('KA07ZZ9999')).toBeTruthy();
  });

  it('disables Next on step 1 until type, purpose, and photo are all provided', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={() => {}} />);
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByText('Car/SUV'));
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByText('Delivery'));
    expect(queryByTestId('step1-next')).toBeNull();
    fireEvent.press(getByTestId('take-photo-button'));
    await waitFor(() => expect(getByTestId('step1-next')).toBeTruthy());
  });

  it('searches units on step 2 and advances to the summary on selection', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({
      data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] },
    });
    const { getByText, getByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);

    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(api.lookupUnits).toHaveBeenCalledWith('A-204'));
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    await waitFor(() => expect(getByText('Send for approval')).toBeTruthy());
  });

  it('sends the complete intake record on submit and shows awaiting-approval', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({
      data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] },
    });
    (api.createApproval as jest.Mock).mockResolvedValue({
      data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } },
    });
    const { getByText, getByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));

    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      unit_number: 'A-204', vehicle_plate: 'Unknown', vehicle_type: 'car', purpose: 'delivery', photoUri: 'file://vehicle.jpg',
    })));
    await waitFor(() => expect(getByText('Awaiting resident approval')).toBeTruthy());
  });

  it('enables Allow entry once the resident approves', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({ data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] } });
    (api.createApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } } });
    (api.getApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'approved', responded_by_name: 'Asha Rao' } } });
    (api.sendGateCommand as jest.Mock).mockResolvedValue({});

    const onClose = jest.fn();
    const { getByText, getByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={onClose} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalled());

    await act(async () => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(getByText('Resident approved')).toBeTruthy());

    fireEvent.press(getByTestId('allow-entry-button'));
    await waitFor(() => expect(api.sendGateCommand).toHaveBeenCalledWith('g1', 'open'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the phone fallback after 3 minutes of no response (NAZ-029)', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({ data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] } });
    (api.createApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } } });
    (api.getApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'expired' } } });

    const { getByText, getByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={() => {}} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalled());

    await act(async () => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(getByText(/No response/i)).toBeTruthy());
    expect(getByText(/9900000000/)).toBeTruthy();
  });

  it('Hold vehicle closes without sending any gate command', async () => {
    (api.lookupUnits as jest.Mock).mockResolvedValue({ data: { data: [{ unitId: 'u1', unitNumber: 'A-204', residentName: 'Asha Rao', relationship: 'owner', mobile: '9900000000' }] } });
    (api.createApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending', expires_at: new Date(Date.now() + 180_000).toISOString() } } });
    (api.getApproval as jest.Mock).mockResolvedValue({ data: { data: { id: 'ap1', status: 'pending' } } });

    const onClose = jest.fn();
    const { getByText, getByTestId } = render(<NewVehicleEntryScreen entry={null} onClose={onClose} />);
    await fillStep1AndAdvance(getByText, getByTestId);
    fireEvent.changeText(getByTestId('unit-search-input'), 'A-204');
    await waitFor(() => expect(getByText(/Asha Rao/)).toBeTruthy());
    fireEvent.press(getByTestId('unit-result-u1'));
    fireEvent.press(await waitFor(() => getByText('Send for approval')));
    await waitFor(() => expect(api.createApproval).toHaveBeenCalled());

    fireEvent.press(getByTestId('hold-vehicle-button'));
    expect(api.sendGateCommand).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
