jest.mock('../api/valet');
jest.mock('../lib/conditionQueue', () => ({ uploadOrQueue: jest.fn() }));
jest.mock('../lib/camera', () => ({
  takePhoto: jest.fn(),
  openAppSettings: jest.fn(),
}));

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import * as api from '../api/valet';
import { uploadOrQueue } from '../lib/conditionQueue';
import { takePhoto } from '../lib/camera';
import ReturnCheckInScreen from './ReturnCheckInScreen';

const TOKEN = 'tok-w';

beforeEach(() => {
  jest.clearAllMocks();
  (takePhoto as jest.Mock).mockResolvedValue({ ok: true, uri: 'file://side.jpg' });
  (uploadOrQueue as jest.Mock).mockResolvedValue({ ok: true, queued: false });
  (api.checkInReturned as jest.Mock).mockResolvedValue({ data: { status: 'parked_again' } });
  (api.getTicket as jest.Mock).mockResolvedValue({
    data: { plate: 'KA05MN4321', vehicleMake: 'Honda City', hasPhoto: true, events: [] },
  });
});

async function captureAll(screen: ReturnType<typeof render>) {
  for (const angle of ['front', 'right', 'back', 'left']) {
    await act(async () => { fireEvent.press(screen.getByTestId(`checkin-angle-${angle}`)); });
  }
}

// A multi-day guest brings the car back. Whatever happened to it happened
// while they had it, so it comes back in the way it first came in: the same
// four views, in the same order.
describe('checking a returned car back in', () => {
  it('names the car being checked in', async () => {
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);

    await waitFor(() => expect(screen.getByText('KA05MN4321')).toBeTruthy());
  });

  it('uploads each side against the intake stage, in the intake order', async () => {
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);

    await captureAll(screen);

    expect((uploadOrQueue as jest.Mock).mock.calls.map((c) => [c[2], c[4]])).toEqual([
      ['intake', 'front'], ['intake', 'right'], ['intake', 'back'], ['intake', 'left'],
    ]);
  });

  it('does not tick off a side the server refused, and lets it be retaken', async () => {
    // ok:false is neither uploaded nor safely queued. Marking it captured
    // would let a set missing a photo look complete until a dispute.
    (uploadOrQueue as jest.Mock).mockResolvedValueOnce({ ok: false, queued: false });
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-angle-front')); });

    expect(screen.getByTestId('checkin-error')).toHaveTextContent(/did not save/);
    await act(async () => { fireEvent.press(screen.getByTestId('checkin-angle-front')); });
    expect((uploadOrQueue as jest.Mock).mock.calls.map((c) => c[4])).toEqual(['front', 'front']);
    expect(screen.queryByTestId('checkin-error')).toBeNull();
  });

  it('says another valet got there first rather than "failed"', async () => {
    (api.checkInReturned as jest.Mock).mockRejectedValue({
      response: { status: 409, data: { error: 'status_changed', status: 'parked_again' } },
    });
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);
    await captureAll(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-done')); });

    expect(screen.getByTestId('checkin-error')).toHaveTextContent(/Another valet/);
    expect(api.listTickets).toHaveBeenCalled();
  });

  it('will not take a side out of turn', async () => {
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-angle-back')); });

    expect(uploadOrQueue).not.toHaveBeenCalled();
  });

  it('will not check the car in until all four sides exist', async () => {
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);
    await act(async () => { fireEvent.press(screen.getByTestId('checkin-angle-front')); });

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-done')); });

    expect(api.checkInReturned).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkin-hint')).toBeTruthy();
  });

  it('checks the car in and goes back to the queue', async () => {
    const onDone = jest.fn();
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} onDone={onDone} />);
    await captureAll(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-done')); });

    expect(api.checkInReturned).toHaveBeenCalledWith(TOKEN);
    expect(onDone).toHaveBeenCalled();
  });

  it('explains a server refusal in the valet\'s words and stays put', async () => {
    (api.checkInReturned as jest.Mock).mockRejectedValue({ response: { data: { error: 'condition_required' } } });
    const onDone = jest.fn();
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} onDone={onDone} />);
    await captureAll(screen);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-done')); });

    expect(screen.getByTestId('checkin-error')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports a camera that would not open instead of doing nothing', async () => {
    (takePhoto as jest.Mock).mockResolvedValue({ ok: false, reason: 'failed', detail: 'camera busy' });
    const screen = render(<ReturnCheckInScreen sessionToken={TOKEN} />);

    await act(async () => { fireEvent.press(screen.getByTestId('checkin-angle-front')); });

    expect(screen.getByText(/camera busy/)).toBeTruthy();
    expect(uploadOrQueue).not.toHaveBeenCalled();
  });
});
