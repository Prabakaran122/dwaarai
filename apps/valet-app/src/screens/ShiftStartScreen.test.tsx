import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('../api/valet', () => ({
  startShift: jest.fn(async () => ({ started: true })),
  listValetPoints: jest.fn(async () => ({ points: [] })),
}));
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: async () => ({ base64: 'aGVsbG8=' }),
      }));
      return React.createElement(View, props);
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

import ShiftStartScreen from './ShiftStartScreen';
import { startShift, listValetPoints } from '../api/valet';

describe('BRD Screen 1b — verify it is you', () => {
  beforeEach(() => jest.clearAllMocks());

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
