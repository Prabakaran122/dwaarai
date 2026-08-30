jest.mock('../api/valet');
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({
    canceled: false, assets: [{ uri: 'file://return.jpg' }],
  }),
}));
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
    // Exposes onBarcodeScanned as a prop the test can fire directly, since a
    // real camera never runs under Jest.
    CameraView: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as api from '../api/valet';
import { useCameraPermissions } from 'expo-camera';
import ValetHandoverScreen from './ValetHandoverScreen';

const TOKEN = 'tok-9';

function axiosError(code: string) {
  return { response: { data: { error: code } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
  (api.scanPickup as jest.Mock).mockResolvedValue({});
  (api.uploadCondition as jest.Mock).mockResolvedValue({});
  (api.confirmPickup as jest.Mock).mockResolvedValue({});
  (api.guestPhotoUrl as jest.Mock).mockReturnValue('https://valet/photo.jpg');
});

async function scanSuccessfully(screen: ReturnType<typeof render>) {
  const camera = screen.getByTestId('handover-camera');
  await act(async () => { camera.props.onBarcodeScanned({ data: 'live-token' }); });
}

describe('scanning the guest QR', () => {
  it('starts on the scanner', () => {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);

    expect(screen.getByTestId('handover-scanner')).toBeTruthy();
  });

  it('sends the scanned code to the service', async () => {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);

    await scanSuccessfully(screen);

    expect(api.scanPickup).toHaveBeenCalledWith(TOKEN, 'live-token');
  });

  it('moves to the photo comparison once the code verifies', async () => {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);

    await scanSuccessfully(screen);

    await waitFor(() => expect(screen.getByTestId('handover-guest-photo')).toBeTruthy());
  });

  it('treats an expired code as a normal retry, not a hard failure', async () => {
    (api.scanPickup as jest.Mock).mockRejectedValue(axiosError('invalid_or_expired'));
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);

    await scanSuccessfully(screen);

    // The guest's QR rotates every few seconds, so catching a stale one is
    // expected — the scanner must stay up rather than dead-ending.
    await waitFor(() => expect(screen.getByTestId('handover-error')).toBeTruthy());
    expect(screen.getByTestId('handover-scanner')).toBeTruthy();
    expect(screen.queryByTestId('handover-guest-photo')).toBeNull();
  });

  it('does not fire repeatedly while the same QR stays in frame', async () => {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    const camera = screen.getByTestId('handover-camera');

    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'live-token' });
      camera.props.onBarcodeScanned({ data: 'live-token' });
      camera.props.onBarcodeScanned({ data: 'live-token' });
    });

    expect(api.scanPickup).toHaveBeenCalledTimes(1);
  });

  it('asks for camera access when it has none', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, jest.fn()]);
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);

    expect(screen.getByTestId('handover-grant')).toBeTruthy();
    expect(screen.queryByTestId('handover-camera')).toBeNull();
  });
});

describe('return condition capture', () => {
  async function reachCondition() {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await scanSuccessfully(screen);
    await act(async () => { fireEvent.press(screen.getByTestId('handover-match')); });
    return screen;
  }

  it('comes after the human photo comparison, not before', async () => {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await scanSuccessfully(screen);

    expect(screen.queryByTestId('handover-angle-front')).toBeNull();
    expect(screen.getByTestId('handover-guest-photo')).toBeTruthy();
  });

  it('uploads a capture against the return stage', async () => {
    const screen = await reachCondition();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-angle-front')); });

    expect(api.uploadCondition).toHaveBeenCalledWith(
      TOKEN, 'file://return.jpg', 'return', 'photo', 'front'
    );
  });

  it('will not let the valet reach confirmation with nothing captured', async () => {
    const screen = await reachCondition();

    expect(screen.getByTestId('handover-condition-hint')).toBeTruthy();
    fireEvent.press(screen.getByTestId('handover-to-confirm'));

    expect(screen.queryByTestId('handover-park-again')).toBeNull();
  });

  it('reaches confirmation once something is captured', async () => {
    const screen = await reachCondition();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-angle-back')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-to-confirm')); });

    await waitFor(() => expect(screen.getByTestId('handover-park-again')).toBeTruthy());
  });
});

describe('confirming the handover', () => {
  async function reachConfirm() {
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await scanSuccessfully(screen);
    await act(async () => { fireEvent.press(screen.getByTestId('handover-match')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-angle-front')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-to-confirm')); });
    return screen;
  }

  it('keeps a multi-day ticket alive by default', async () => {
    const screen = await reachConfirm();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-park-again')); });

    expect(api.confirmPickup).toHaveBeenCalledWith(TOKEN, false);
  });

  it('closes the ticket on a final checkout', async () => {
    const screen = await reachConfirm();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-final')); });

    expect(api.confirmPickup).toHaveBeenCalledWith(TOKEN, true);
  });

  it('calls back once the handover succeeds', async () => {
    const onDone = jest.fn();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} onDone={onDone} />);
    await scanSuccessfully(screen);
    await act(async () => { fireEvent.press(screen.getByTestId('handover-match')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-angle-front')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-to-confirm')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-park-again')); });

    expect(onDone).toHaveBeenCalled();
  });

  it('explains a server-side missing return capture in the valet\'s own words', async () => {
    (api.confirmPickup as jest.Mock).mockRejectedValue(axiosError('return_condition_required'));
    const screen = await reachConfirm();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-park-again')); });

    await waitFor(() => expect(screen.getByTestId('handover-error')).toBeTruthy());
  });

  it('explains a server-side missing scan too', async () => {
    (api.confirmPickup as jest.Mock).mockRejectedValue(axiosError('scan_required'));
    const screen = await reachConfirm();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-park-again')); });

    await waitFor(() => expect(screen.getByTestId('handover-error')).toBeTruthy());
  });
});
