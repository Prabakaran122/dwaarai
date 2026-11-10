jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('react-native', () => ({ Linking: { openSettings: jest.fn() } }));

import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { takePhoto, openAppSettings } from './camera';

const granted = { granted: true, canAskAgain: true };

beforeEach(() => {
  jest.clearAllMocks();
  // Not yet granted by default, so the request path below is what most tests exercise.
  (ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false, canAskAgain: true });
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue(granted);
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false, assets: [{ uri: 'file://shot.jpg' }],
  });
});

describe('takePhoto', () => {
  it('returns the captured image', async () => {
    await expect(takePhoto()).resolves.toEqual({ ok: true, uri: 'file://shot.jpg' });
  });

  it('never throws when the picker throws', async () => {
    // This is the whole point. The screens awaited the picker outside their
    // try/catch, so anything it threw became an unhandled rejection and the
    // button silently did nothing — no camera, no error, nothing to report.
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('camera busy'));

    const res = await takePhoto();

    expect(res).toEqual({ ok: false, reason: 'failed', detail: 'camera busy' });
  });

  it('never throws when even the permission request throws', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockRejectedValue(new Error('no activity'));

    await expect(takePhoto()).resolves.toEqual({
      ok: false, reason: 'failed', detail: 'no activity',
    });
  });

  it('survives a rejection that is not an Error', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue('boom');

    await expect(takePhoto()).resolves.toEqual({ ok: false, reason: 'failed', detail: 'boom' });
  });

  it('reports a permanent refusal separately from a one-off one', async () => {
    // Android stops prompting after two refusals, so "allow the camera" is
    // advice the valet cannot act on — only the settings screen can.
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: false, canAskAgain: false });

    await expect(takePhoto()).resolves.toEqual({ ok: false, reason: 'blocked' });
  });

  it('reports a refusal that can still be re-asked', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(takePhoto()).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('does not open the camera at all without permission', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock)
      .mockResolvedValue({ granted: false, canAskAgain: true });

    await takePhoto();

    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('treats backing out as a cancel, not an error', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });

    await expect(takePhoto()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('treats an empty result as a failure, not a cancel', async () => {
    // The camera came back; calling that a cancel would silently drop a photo
    // the valet believes they just took.
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [] });

    await expect(takePhoto()).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('openAppSettings', () => {
  it('opens the OS settings page', async () => {
    await openAppSettings();

    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('does not throw when the settings intent fails', async () => {
    (Linking.openSettings as jest.Mock).mockRejectedValue(new Error('no handler'));

    await expect(openAppSettings()).resolves.toBeUndefined();
  });
});

describe('Android 16 on Pixels: never re-ask for a permission already held', () => {
  // expo/expo#39480. On Pixels running Android 16, requesting a permission the
  // app already has can return a promise that never settles ("No requestable
  // permission in the request"). takePhoto asked on every tap, so the camera
  // button hung -- no camera, no error -- until the app was backgrounded.

  it('opens the camera without requesting when permission is already granted', async () => {
    (ImagePicker.getCameraPermissionsAsync as jest.Mock).mockResolvedValue(granted);

    await expect(takePhoto()).resolves.toEqual({ ok: true, uri: 'file://shot.jpg' });
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
  });

  it('still asks when the permission has not been granted yet', async () => {
    await expect(takePhoto()).resolves.toEqual({ ok: true, uri: 'file://shot.jpg' });
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to asking if reading the permission fails', async () => {
    (ImagePicker.getCameraPermissionsAsync as jest.Mock).mockRejectedValue(new Error('no activity'));

    await expect(takePhoto()).resolves.toEqual({ ok: true, uri: 'file://shot.jpg' });
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
