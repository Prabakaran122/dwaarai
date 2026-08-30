jest.mock('../../api/valet');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({
    canceled: false, assets: [{ uri: 'file://shot.jpg' }],
  }),
}));

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as api from '../../api/valet';
import NewValetTicketScreen from './NewValetTicketScreen';

const createdTicket = {
  id: 'id-1',
  displayId: 'SRT-0009',
  sessionToken: 'tok-9',
  guestUrl: 'https://dwaarai.com/valet/v/tok-9',
  qrDataUrl: 'data:image/png;base64,QR',
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.lookupPlate as jest.Mock).mockResolvedValue({ data: { isReturning: false } });
  (api.createTicket as jest.Mock).mockResolvedValue({ data: createdTicket });
  (api.uploadGuestPhoto as jest.Mock).mockResolvedValue({});
  (api.uploadCondition as jest.Mock).mockResolvedValue({});
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false, assets: [{ uri: 'file://shot.jpg' }],
  });
});

async function fillDetails(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByTestId('valet-plate-input'), 'KA03NJ0435');
  fireEvent.changeText(screen.getByTestId('valet-make-input'), 'Maruti Swift');
  await act(async () => { fireEvent.press(screen.getByTestId('valet-create')); });
}

describe('ticket details', () => {
  it('will not create a ticket until plate and make are both filled', () => {
    const screen = render(<NewValetTicketScreen />);

    fireEvent.press(screen.getByTestId('valet-create'));

    expect(api.createTicket).not.toHaveBeenCalled();
  });

  it('creates a ticket with a future stay-end', async () => {
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(api.createTicket).toHaveBeenCalledTimes(1);
    const [plate, make, stayEndAt] = (api.createTicket as jest.Mock).mock.calls[0];
    expect(plate).toBe('KA03NJ0435');
    expect(make).toBe('Maruti Swift');
    expect(new Date(stayEndAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('uses the selected stay length', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-days-7'));

    await fillDetails(screen);

    const stayEndAt = (api.createTicket as jest.Mock).mock.calls[0][2];
    const daysOut = (new Date(stayEndAt).getTime() - Date.now()) / 86400000;
    expect(daysOut).toBeGreaterThan(6.5);
  });

  it('shows the guest QR once the ticket exists', async () => {
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    await waitFor(() => expect(screen.getByTestId('valet-qr-card')).toBeTruthy());
    expect(screen.getByText('SRT-0009')).toBeTruthy();
  });

  it('reports a failure instead of pretending the ticket was made', async () => {
    (api.createTicket as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    await waitFor(() => expect(screen.getByTestId('valet-error')).toBeTruthy());
  });
});

describe('returning vehicle banner', () => {
  it('surfaces a prior visit while the valet is still typing', async () => {
    (api.lookupPlate as jest.Mock).mockResolvedValue({
      data: { isReturning: true, visitCount: 3, lastVisitAt: '2026-04-12T10:00:00Z' },
    });
    const screen = render(<NewValetTicketScreen />);

    fireEvent.changeText(screen.getByTestId('valet-plate-input'), 'KA03NJ0435');

    await waitFor(() => expect(screen.getByTestId('valet-returning-banner')).toBeTruthy(), { timeout: 2000 });
  });

  it('stays hidden for a first-time vehicle', async () => {
    const screen = render(<NewValetTicketScreen />);

    fireEvent.changeText(screen.getByTestId('valet-plate-input'), 'KA03NJ0435');
    await waitFor(() => expect(api.lookupPlate).toHaveBeenCalled(), { timeout: 2000 });

    expect(screen.queryByTestId('valet-returning-banner')).toBeNull();
  });

  it('does not look up a plate too short to mean anything', () => {
    const screen = render(<NewValetTicketScreen />);

    fireEvent.changeText(screen.getByTestId('valet-plate-input'), 'KA');

    expect(api.lookupPlate).not.toHaveBeenCalled();
  });

  it('never blocks ticket creation when the lookup itself fails', async () => {
    (api.lookupPlate as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(api.createTicket).toHaveBeenCalled();
  });
});

describe('guest photo', () => {
  it('uploads the photo against the new ticket', async () => {
    const screen = render(<NewValetTicketScreen />);
    await fillDetails(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(api.uploadGuestPhoto).toHaveBeenCalledWith('tok-9', 'file://shot.jpg');
  });

  it('can be skipped, so a denied camera does not strand a parked car', async () => {
    const screen = render(<NewValetTicketScreen />);
    await fillDetails(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('valet-skip-photo')); });

    await waitFor(() => expect(screen.getByTestId('valet-angle-front')).toBeTruthy());
    expect(api.uploadGuestPhoto).not.toHaveBeenCalled();
  });

  it('explains a denied camera rather than failing silently', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const screen = render(<NewValetTicketScreen />);
    await fillDetails(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    await waitFor(() => expect(screen.getByTestId('valet-error')).toBeTruthy());
    expect(api.uploadGuestPhoto).not.toHaveBeenCalled();
  });
});

describe('intake condition capture', () => {
  async function reachCondition() {
    const screen = render(<NewValetTicketScreen />);
    await fillDetails(screen);
    await act(async () => { fireEvent.press(screen.getByTestId('valet-skip-photo')); });
    return screen;
  }

  it('uploads each angle as it is taken, not in one batch at the end', async () => {
    const screen = await reachCondition();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-angle-front')); });

    // One dropped connection should cost one shot, never the whole set.
    expect(api.uploadCondition).toHaveBeenCalledWith('tok-9', 'file://shot.jpg', 'intake', 'photo', 'front');
  });

  it('blocks finishing until at least one capture exists', async () => {
    const screen = await reachCondition();

    expect(screen.getByTestId('valet-condition-hint')).toBeTruthy();
    fireEvent.press(screen.getByTestId('valet-finish'));

    expect(screen.queryByTestId('valet-done-card')).toBeNull();
  });

  it('allows finishing once a capture exists', async () => {
    const screen = await reachCondition();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-angle-front')); });
    await act(async () => { fireEvent.press(screen.getByTestId('valet-finish')); });

    await waitFor(() => expect(screen.getByTestId('valet-done-card')).toBeTruthy());
  });

  it('supports all four angles', async () => {
    const screen = await reachCondition();

    for (const angle of ['front', 'back', 'left', 'right']) {
      expect(screen.getByTestId(`valet-angle-${angle}`)).toBeTruthy();
    }
  });
});
