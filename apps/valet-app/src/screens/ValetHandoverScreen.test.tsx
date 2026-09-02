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
import ValetHandoverScreen, { maskPlate } from './ValetHandoverScreen';

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
  (api.guestPhotoSource as jest.Mock).mockReturnValue({
    uri: 'https://valet/photo.jpg', headers: { Authorization: 'Bearer t' },
  });
  (api.getTicket as jest.Mock).mockResolvedValue({
    data: { hasPhoto: true, plate: 'KA03NJ0435', vehicleMake: 'Swift', events: [] },
  });
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

    expect(api.confirmPickup).toHaveBeenCalledWith(TOKEN, false, 'photo');
  });

  it('closes the ticket on a final checkout', async () => {
    const screen = await reachConfirm();

    await act(async () => { fireEvent.press(screen.getByTestId('handover-final')); });

    expect(api.confirmPickup).toHaveBeenCalledWith(TOKEN, true, 'photo');
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

describe('when no photo was captured at intake', () => {
  function noPhotoTicket() {
    (api.getTicket as jest.Mock).mockResolvedValue({
      data: { hasPhoto: false, plate: 'KA 03 NJ 0435', vehicleMake: 'Maruti Swift', events: [] },
    });
  }

  async function reachCompare(screen: ReturnType<typeof render>) {
    await act(async () => {
      screen.getByTestId('handover-camera').props.onBarcodeScanned({ data: 'live-token' });
    });
  }

  it('says no photo was taken instead of showing an empty frame', async () => {
    // The bug this replaces: <Image> sent no auth header, so the frame was
    // blank for every ticket, and the guard was asked to compare a face
    // against nothing and then told the server it matched.
    noPhotoTicket();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    expect(screen.getByTestId('handover-no-photo')).toBeTruthy();
    expect(screen.queryByTestId('handover-guest-photo')).toBeNull();
    expect(screen.queryByTestId('handover-match')).toBeNull();
  });

  it('gives the guard something real to check', async () => {
    noPhotoTicket();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    expect(screen.getByTestId('handover-vehicle').props.children).toBe('Maruti Swift');
  });

  it('masks the last four digits — the plate is the answer being asked for', async () => {
    noPhotoTicket();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    const shown = screen.getByTestId('handover-plate').props.children;
    expect(shown).toBe('KA 03 NJ ••••');
    expect(shown).not.toContain('0435');
  });

  it('records a vehicle confirmation, never a photo match', async () => {
    noPhotoTicket();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('handover-vehicle-confirmed')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-angle-front')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-to-confirm')); });
    await act(async () => { fireEvent.press(screen.getByTestId('handover-park-again')); });

    expect(api.confirmPickup).toHaveBeenCalledWith(TOKEN, false, 'vehicle_confirmed');
  });

  it('lets the guard hold the car when the guest cannot confirm', async () => {
    noPhotoTicket();
    const onDone = jest.fn();
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} onDone={onDone} />);
    await reachCompare(screen);

    fireEvent.press(screen.getByTestId('handover-hold'));

    expect(onDone).toHaveBeenCalled();
    expect(api.confirmPickup).not.toHaveBeenCalled();
  });

  it('still shows the photo when one exists', async () => {
    (api.getTicket as jest.Mock).mockResolvedValue({
      data: { hasPhoto: true, plate: 'KA 03 NJ 0435', vehicleMake: 'Swift', events: [] },
    });
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    expect(screen.getByTestId('handover-guest-photo')).toBeTruthy();
    expect(screen.queryByTestId('handover-no-photo')).toBeNull();
  });

  it('sends the photo request with the guard token', async () => {
    // Without the header this endpoint answers 401 and the frame is blank.
    (api.getTicket as jest.Mock).mockResolvedValue({
      data: { hasPhoto: true, plate: 'KA03NJ0435', vehicleMake: 'Swift', events: [] },
    });
    const screen = render(<ValetHandoverScreen sessionToken={TOKEN} />);
    await reachCompare(screen);

    const src = screen.getByTestId('handover-guest-photo').props.source;
    expect(src.headers.Authorization).toBeTruthy();
  });
});

describe('maskPlate', () => {
  it('hides the last four digits', () => {
    expect(maskPlate('KA 03 NJ 0435')).toBe('KA 03 NJ ••••');
  });

  it('leaves a very short plate alone rather than blanking it entirely', () => {
    expect(maskPlate('0435')).toBe('0435');
  });

  it('survives a missing plate', () => {
    expect(maskPlate('')).toBe('');
  });
});
