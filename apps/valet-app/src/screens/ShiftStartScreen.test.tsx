import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

jest.mock('../api/valet', () => ({
  startShift: jest.fn(async () => ({ started: true })),
  listValetPoints: jest.fn(async () => ({ points: [] })),
}));
// How the fake camera behaves; each test resets it. By default it starts and
// hands back a photo, like a working phone.
let mockCamera: { start: 'ready' | 'error' | 'never'; shot: () => Promise<any> };
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: () => mockCamera.shot(),
      }));
      React.useEffect(() => {
        if (mockCamera.start === 'ready') props.onCameraReady?.();
        if (mockCamera.start === 'error') props.onMountError?.({ message: 'No available camera can be found' });
      }, []);
      return React.createElement(View, props);
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

import ShiftStartScreen from './ShiftStartScreen';
import { startShift, listValetPoints } from '../api/valet';

beforeEach(() => {
  jest.clearAllMocks();
  mockCamera = { start: 'ready', shot: async () => ({ base64: 'aGVsbG8=' }) };
});

describe('BRD Screen 1b — verify it is you', () => {

  it('sends the photo and advances on capture, with no continue tap', async () => {
    const onDone = jest.fn();
    const { getByTestId } = render(<ShiftStartScreen onDone={onDone} />);

    fireEvent.press(getByTestId('shift-capture'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(startShift).toHaveBeenCalledWith('aGVsbG8=', undefined);
  });

  it('starts the shift anyway when the valet skips', async () => {
    const onDone = jest.fn();
    const { getByTestId } = render(<ShiftStartScreen onDone={onDone} />);

    fireEvent.press(getByTestId('shift-skip'));

    // Recorded as a shift with no photo rather than no shift at all.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(startShift).toHaveBeenCalledWith(undefined, undefined);
  });

  it('still lets the valet work when the upload fails', async () => {
    (startShift as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const onDone = jest.fn();
    const { getByTestId } = render(<ShiftStartScreen onDone={onDone} />);

    fireEvent.press(getByTestId('shift-capture'));

    // A valet with cars to park must not be stranded by a failed request.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('hides both buttons while it is working, so neither can fire twice', async () => {
    const onDone = jest.fn();
    const { getByTestId, queryByTestId } = render(<ShiftStartScreen onDone={onDone} />);

    fireEvent.press(getByTestId('shift-capture'));

    // The capture is in flight: there is nothing left to tap. A second
    // advance is prevented by the screen rather than by a guard nobody can
    // reach, and the guard stays as the backstop.
    expect(queryByTestId('shift-capture')).toBeNull();
    expect(queryByTestId('shift-skip')).toBeNull();

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe('which door the attendant is working', () => {
  it('offers the venue’s valet points and sends the chosen one', async () => {
    // The shift log has a "Valet point" column and the server accepts one.
    // Without this the column is blank for every shift ever recorded, and
    // "which door was Suresh on" stays unanswerable.
    (listValetPoints as jest.Mock).mockResolvedValue({
      points: [{ id: 'p1', name: 'Main porch' }, { id: 'p2', name: 'Banquet entrance' }],
    });

    const { getByTestId, getByText } = render(<ShiftStartScreen onDone={jest.fn()} />);
    await waitFor(() => expect(getByText('Banquet entrance')).toBeTruthy());

    fireEvent.press(getByText('Banquet entrance'));
    fireEvent.press(getByTestId('shift-capture'));

    await waitFor(() =>
      expect(startShift).toHaveBeenCalledWith(expect.anything(), 'Banquet entrance'));
  });

  it('starts the shift anyway when a venue has defined no points', async () => {
    // Plenty of venues have one door and never set this up. Blocking the
    // shift over it would strand them.
    (listValetPoints as jest.Mock).mockResolvedValue({ points: [] });

    const onDone = jest.fn();
    const { getByTestId } = render(<ShiftStartScreen onDone={onDone} />);
    fireEvent.press(getByTestId('shift-capture'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('never blocks the shift when the point list cannot be fetched', async () => {
    (listValetPoints as jest.Mock).mockRejectedValue(new Error('offline'));

    const onDone = jest.fn();
    const { getByTestId } = render(<ShiftStartScreen onDone={onDone} />);
    fireEvent.press(getByTestId('shift-capture'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('a camera that does not work', () => {
  // Seen on an emulator with no front camera: permission granted, CameraX
  // finds no front lens, and the screen showed a black box with a live
  // "Take photo" that quietly started the shift with no photo.

  it('says so when the camera fails to start, and offers only Skip', async () => {
    mockCamera.start = 'error';
    const { findByTestId, queryByTestId, getByTestId } = render(<ShiftStartScreen onDone={jest.fn()} />);

    expect(await findByTestId('shift-camera-failed')).toBeTruthy();
    expect(queryByTestId('shift-capture')).toBeNull();
    expect(getByTestId('shift-skip')).toBeTruthy();
  });

  it('gives up waiting on a camera that never starts', async () => {
    jest.useFakeTimers();
    try {
      mockCamera.start = 'never';
      const { queryByTestId } = render(<ShiftStartScreen onDone={jest.fn()} />);
      // Still starting: no button that would take a picture of nothing.
      expect(queryByTestId('shift-capture')).toBeNull();

      act(() => { jest.advanceTimersByTime(8000); });
      expect(queryByTestId('shift-camera-failed')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not start the shift on a capture that produced no photo', async () => {
    mockCamera.shot = async () => { throw new Error('Camera is not running'); };
    const onDone = jest.fn();
    const { getByTestId, findByTestId } = render(<ShiftStartScreen onDone={onDone} />);

    fireEvent.press(getByTestId('shift-capture'));

    // The valet is told, and Skip is how they carry on -- a shift recorded
    // as "photo taken" with no photo is the thing being fixed.
    expect(await findByTestId('shift-camera-failed')).toBeTruthy();
    expect(startShift).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
