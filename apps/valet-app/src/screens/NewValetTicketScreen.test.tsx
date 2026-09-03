jest.mock('../api/valet');
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
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({
    canceled: false, assets: [{ uri: 'file://shot.jpg' }],
  }),
}));

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as api from '../api/valet';
import { useCameraPermissions } from 'expo-camera';
import NewValetTicketScreen from './NewValetTicketScreen';

const createdTicket = {
  id: 'id-1',
  displayId: 'SRT-0009',
  sessionToken: 'tok-9',
  guestUrl: 'https://dwaarai.com/valet/v/tok-9',
  qrDataUrl: 'data:image/png;base64,QR',
  cardCode: null as string | null,
  claimCode: null as string | null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
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


describe('binding a printed card at intake', () => {
  // Card QRs carry the venue: codes are unique per venue, not globally.
  const CARD_QR = 'https://dwaarai.com/valet/c/978aa095-6aa9-45b6-b6d5-d3a915dfca38/A047';

  it('does not force a card: a venue with no stock takes cars in as before', async () => {
    const screen = render(<NewValetTicketScreen />);

    // The create button must be reachable without ever touching the scanner.
    await fillDetails(screen);

    expect(api.createTicket).toHaveBeenCalledWith(
      'KA03NJ0435', 'Maruti Swift', expect.any(String), undefined
    );
  });

  it('says so rather than leaving the card row blank', () => {
    const screen = render(<NewValetTicketScreen />);

    expect(screen.getByTestId('valet-no-card-hint')).toBeTruthy();
  });

  it('reads a card code out of its scanned QR', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    await act(async () => {
      screen.getByTestId('card-camera').props.onBarcodeScanned({
        data: CARD_QR,
      });
    });

    expect(screen.getByTestId('valet-card-chip')).toBeTruthy();
    expect(screen.getByText(/A047/)).toBeTruthy();
  });

  it('sends the scanned card with the ticket', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));
    await act(async () => {
      screen.getByTestId('card-camera').props.onBarcodeScanned({
        data: CARD_QR,
      });
    });

    await fillDetails(screen);

    expect(api.createTicket).toHaveBeenCalledWith(
      'KA03NJ0435', 'Maruti Swift', expect.any(String), 'A047'
    );
  });

  it('stays on the scanner when the QR is not a valet card', async () => {
    // The valet is holding a card and pointing it at something; dropping them
    // back to the form loses that.
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    await act(async () => {
      screen.getByTestId('card-camera').props.onBarcodeScanned({ data: 'https://example.com/menu' });
    });

    expect(screen.getByTestId('card-camera')).toBeTruthy();
    expect(screen.queryByTestId('valet-card-chip')).toBeNull();
    expect(screen.getByTestId('valet-error')).toBeTruthy();
  });

  it('accepts a code typed off the card when the camera will not focus', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    fireEvent.changeText(screen.getByTestId('valet-card-input'), 'a047');
    await act(async () => { fireEvent.press(screen.getByTestId('valet-card-use')); });

    expect(screen.getByText(/A047/)).toBeTruthy();
  });

  it('lets a valet take the wrong card back off', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));
    await act(async () => {
      screen.getByTestId('card-camera').props.onBarcodeScanned({
        data: CARD_QR,
      });
    });

    fireEvent.press(screen.getByTestId('valet-card-clear'));

    expect(screen.queryByTestId('valet-card-chip')).toBeNull();
    expect(screen.getByTestId('valet-scan-card')).toBeTruthy();
  });

  it('can back out of the scanner without binding anything', async () => {
    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    fireEvent.press(screen.getByTestId('valet-card-cancel'));

    expect(screen.getByTestId('valet-plate-input')).toBeTruthy();
    expect(screen.queryByTestId('valet-card-chip')).toBeNull();
  });

  it('names the clash when the card is already on another vehicle', async () => {
    // The valet is holding the wrong card — a generic failure gives them
    // nothing to act on.
    (api.createTicket as jest.Mock).mockRejectedValue({
      response: { data: { error: 'card_in_use' } },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByText(/already on another vehicle/i)).toBeTruthy();
  });

  it('says when the card is not registered at this property', async () => {
    (api.createTicket as jest.Mock).mockRejectedValue({
      response: { data: { error: 'unknown_card' } },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByText(/not registered here/i)).toBeTruthy();
  });

  it('does not advance past the form when creation fails', async () => {
    (api.createTicket as jest.Mock).mockRejectedValue({
      response: { data: { error: 'card_in_use' } },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    // The car is not taken in, so the valet must still be on the form.
    expect(screen.getByTestId('valet-plate-input')).toBeTruthy();
  });
});

describe('what the guest is handed', () => {
  it('tells the valet to hand over the card when one is bound', async () => {
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: 'A047' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    // With plastic in hand, "show the QR on screen" would have the valet hand
    // over nothing and the guest keep a card nobody told them to keep.
    expect(screen.getByTestId('valet-card-handout')).toBeTruthy();
    expect(screen.getByTestId('valet-handout-code').props.children).toBe('A047');
    expect(screen.queryByTestId('valet-qr-card')).toBeNull();
  });

  it('still offers the screen QR alongside the card', async () => {
    // A guest who would rather use their own phone can.
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: 'A047' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.UNSAFE_getAllByType(require('react-native').Image).length).toBeGreaterThan(0);
  });

  it('falls back to the screen QR when there is no card', async () => {
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByTestId('valet-qr-card')).toBeTruthy();
    expect(screen.queryByTestId('valet-card-handout')).toBeNull();
  });
});

describe('when the camera will not open', () => {
  beforeEach(() => {
    // Implementations survive clearAllMocks(), so restore the happy path
    // before each case rather than inheriting the previous one's failure.
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: true, canAskAgain: true });
    (ImagePicker.launchCameraAsync as jest.Mock)
      .mockResolvedValue({ canceled: false, assets: [{ uri: 'file://shot.jpg' }] });
  });

  // Reported from a Pixel: tapping capture did nothing at all. The picker was
  // awaited outside the caller's try/catch, so anything it threw became an
  // unhandled rejection — no camera, no error, nothing to report.
  async function reachPhotoStep() {
    const screen = render(<NewValetTicketScreen />);
    await fillDetails(screen);
    return screen;
  }

  it('shows an error instead of doing nothing when the picker throws', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('camera busy'));
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByTestId('valet-error')).toBeTruthy();
  });

  it('names the reason, so a valet at a stand has something to report', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('camera busy'));
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByText(/camera busy/)).toBeTruthy();
  });

  it('survives the permission request itself throwing', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockRejectedValue(new Error('no activity'));
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByTestId('valet-error')).toBeTruthy();
  });

  it('offers the settings screen when the OS will not prompt again', async () => {
    // Two refusals and Android stops asking; "allow the camera" is then advice
    // the valet cannot act on.
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: false, canAskAgain: false });
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByTestId('valet-open-settings')).toBeTruthy();
  });

  it('does not offer settings for a refusal that can be re-asked', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: false, canAskAgain: true });
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByTestId('valet-error')).toBeTruthy();
    expect(screen.queryByTestId('valet-open-settings')).toBeNull();
  });

  it('stays silent when the valet simply backs out of the camera', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.queryByTestId('valet-error')).toBeNull();
  });

  it('does not advance the flow when the camera failed', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('camera busy'));
    const screen = await reachPhotoStep();

    await act(async () => { fireEvent.press(screen.getByTestId('valet-capture-photo')); });

    expect(screen.getByTestId('valet-capture-photo')).toBeTruthy();
    expect(api.uploadGuestPhoto).not.toHaveBeenCalled();
  });

  it('reports a failed condition capture too', async () => {
    const screen = await reachPhotoStep();
    fireEvent.press(screen.getByTestId('valet-skip-photo'));
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('lens jammed'));

    await act(async () => { fireEvent.press(screen.getByTestId('valet-angle-front')); });

    expect(screen.getByText(/lens jammed/)).toBeTruthy();
    expect(api.uploadCondition).not.toHaveBeenCalled();
  });
});

describe('opening the card scanner', () => {
  it('asks for the camera on the way in, not after the screen is open', () => {
    // A scanner that opens onto a permission notice reads as the camera simply
    // not working.
    const request = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: true }, request,
    ]);

    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    expect(request).toHaveBeenCalled();
  });

  it('does not re-ask once the OS has stopped prompting', () => {
    const request = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: false }, request,
    ]);

    const screen = render(<NewValetTicketScreen />);
    fireEvent.press(screen.getByTestId('valet-scan-card'));

    expect(request).not.toHaveBeenCalled();
  });
});

describe('what the guest leaves with when there is no card', () => {
  // Scanning the screen QR only works while the guest is standing there.
  // Photographing it barely helps — reading that picture back needs a second
  // device — so without a card they had no route to their own vehicle.
  it('shows a code the guest can take away', async () => {
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: null, claimCode: '4K7QP2' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByTestId('valet-claim-code').props.children).toBe('4K7QP2');
  });

  it('tells the valet where the guest should enter it', async () => {
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: null, claimCode: '4K7QP2' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByText(/dwaarai\.com\/valet/)).toBeTruthy();
  });

  it('leads with the card when one is bound, not the code', async () => {
    // Plastic in hand beats a code to remember.
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: 'A047', claimCode: '4K7QP2' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByTestId('valet-handout-code').props.children).toBe('A047');
    expect(screen.queryByTestId('valet-claim-code')).toBeNull();
  });

  it('still renders the QR alongside the code', async () => {
    (api.createTicket as jest.Mock).mockResolvedValue({
      data: { ...createdTicket, cardCode: null, claimCode: '4K7QP2' },
    });
    const screen = render(<NewValetTicketScreen />);

    await fillDetails(screen);

    expect(screen.getByTestId('valet-qr-card')).toBeTruthy();
  });
});
