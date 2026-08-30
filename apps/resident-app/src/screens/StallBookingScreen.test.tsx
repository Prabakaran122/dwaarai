jest.mock('../api/client');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import StallBookingScreen from './StallBookingScreen';
import type { Stall } from '../store/eventsStore';

function stall(overrides: Partial<Stall> = {}): Stall {
  // 2000 rupees = 200000 paise; 3% = 6000 paise (money.js rounds to whole rupees).
  return {
    id: 's1', code: 'A1', stallType: 'standard',
    pricePaise: 200000, platformFeePaise: 6000, totalPaise: 206000,
    status: 'available', row: 0, col: 0,
    ...overrides,
  };
}

function mockStalls(stalls: Stall[]) {
  (api.getEventStalls as jest.Mock).mockResolvedValue({
    data: { data: { stalls, available: stalls.filter((s) => s.status === 'available').length, total: stalls.length } },
  });
}

function renderScreen(props: Partial<React.ComponentProps<typeof StallBookingScreen>> = {}) {
  return render(
    <StallBookingScreen eventId="e1" eventTitle="Ganesh Puja" onBack={jest.fn()} {...props} />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStalls([stall()]);
  (api.bookStall as jest.Mock).mockResolvedValue({ data: { data: { gatewayOrderId: 'order_test_1' } } });
});

describe('stall map (FR-STL-01)', () => {
  it('renders each stall with its code and price', async () => {
    mockStalls([stall({ id: 'a', code: 'A1' }), stall({ id: 'b', code: 'B2', col: 1 })]);

    const { getByTestId, getByText, getAllByText } = renderScreen();

    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());
    expect(getByTestId('stall-B2')).toBeTruthy();
    expect(getAllByText('₹2,000')).toHaveLength(2);
  });

  it('explains an event with no stalls set up', async () => {
    mockStalls([]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText(/no stalls have been set up/i)).toBeTruthy());
  });

  it('reports a failed load instead of showing an empty map', async () => {
    (api.getEventStalls as jest.Mock).mockRejectedValue(new Error('offline'));

    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('stall-error')).toBeTruthy());
  });
});

describe('selection (FR-STL-02, FR-STL-03)', () => {
  it('shows the booking summary once a stall is selected', async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    expect(queryByTestId('booking-summary')).toBeNull();
    fireEvent.press(getByTestId('stall-A1'));

    expect(getByTestId('booking-summary')).toBeTruthy();
  });

  it('replaces the selection rather than adding a second stall', async () => {
    mockStalls([stall({ id: 'a', code: 'A1' }), stall({ id: 'b', code: 'B2', col: 1, pricePaise: 500000, platformFeePaise: 15000, totalPaise: 515000 })]);
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('stall-B2'));

    // Only the second stall's total is on screen — one booking session, one stall.
    expect(getByText('₹5,150')).toBeTruthy();
    expect(queryByText('₹2,060')).toBeNull();
  });

  it('deselects when the same stall is tapped again', async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('stall-A1'));

    expect(queryByTestId('booking-summary')).toBeNull();
  });

  it('cannot select a stall that is already booked', async () => {
    mockStalls([stall({ status: 'booked' })]);
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));

    expect(queryByTestId('booking-summary')).toBeNull();
  });
});

describe('booking summary (FR-STL-04)', () => {
  it('itemises stall fee, the 3% platform fee, and the total', async () => {
    const { getByTestId, getByText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));

    expect(getByText(/platform fee \(3%\)/i)).toBeTruthy();
    expect(getByText('₹60')).toBeTruthy();      // the fee, as its own line
    expect(getByText(/total payable/i)).toBeTruthy();
    expect(getByText('₹2,060')).toBeTruthy();   // fee included in the total
  });

  it('displays the server figures rather than recomputing the fee', async () => {
    // A deliberately inconsistent payload: if the screen did its own 3% maths
    // it would render ₹60, not the ₹99 the server actually sent.
    mockStalls([stall({ platformFeePaise: 9900, totalPaise: 209900 })]);
    const { getByTestId, getByText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));

    expect(getByText('₹99')).toBeTruthy();
    expect(getByText('₹2,099')).toBeTruthy();
  });
});

describe('type filter (FR-STL-08)', () => {
  it('offers a chip per stall type plus All', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    for (const id of ['stall-type-all', 'stall-type-standard', 'stall-type-premium', 'stall-type-corner']) {
      expect(getByTestId(id)).toBeTruthy();
    }
  });

  it('keeps non-matching stalls on the map, faded, rather than removing them', async () => {
    mockStalls([stall({ id: 'a', code: 'A1', stallType: 'standard' }), stall({ id: 'b', code: 'P1', stallType: 'premium', col: 1 })]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-type-premium'));

    // Both still present — the map must keep its shape so a stall's physical
    // position stays recognisable.
    expect(getByTestId('stall-A1')).toBeTruthy();
    expect(getByTestId('stall-P1')).toBeTruthy();
  });
});

describe('confirming the booking', () => {
  it('reserves the selected stall', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('confirm-booking'));

    await waitFor(() => expect(api.bookStall).toHaveBeenCalledWith('e1', 's1'));
  });

  it('tells the resident plainly when someone else took the stall first', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue({ response: { status: 409 } });
    const { getByTestId, getByText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('confirm-booking'));

    await waitFor(() => expect(getByText(/someone just booked that stall/i)).toBeTruthy());
  });

  it('refreshes the map after a clash so the taken stall stops being offered', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue({ response: { status: 409 } });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());
    (api.getEventStalls as jest.Mock).mockClear();

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('confirm-booking'));

    await waitFor(() => expect(api.getEventStalls).toHaveBeenCalled());
  });

  it('reports a generic failure for anything that is not a clash', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue(new Error('offline'));
    const { getByTestId, getByText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('confirm-booking'));

    await waitFor(() => expect(getByText(/could not reserve that stall/i)).toBeTruthy());
  });

  it('hands the booking back to the caller for the confirmation screen (FR-STL-07)', async () => {
    const onBooked = jest.fn();
    const { getByTestId } = renderScreen({ onBooked });
    await waitFor(() => expect(getByTestId('stall-A1')).toBeTruthy());

    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('confirm-booking'));

    await waitFor(() => expect(onBooked).toHaveBeenCalledWith({ stallCode: 'A1', totalPaise: 206000 }));
  });
});
