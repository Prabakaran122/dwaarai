import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import StallBookingScreen, { platformFeePaise, inr } from './StallBookingScreen';
import { useEventsStore, Stall } from '../store/eventsStore';
import * as api from '../api/client';

jest.mock('../api/client');
jest.mock('../lib/checkout', () => ({
  payWithRazorpay: jest.fn(),
  confirmPayment: jest.fn(),
}));

const { payWithRazorpay, confirmPayment } = require('../lib/checkout');

const stalls: Stall[] = [
  { id: 's1', code: 'A1', stallType: 'standard', pricePaise: 200000, status: 'available', rowIndex: 0, colIndex: 0 },
  { id: 's2', code: 'A2', stallType: 'premium', pricePaise: 500000, status: 'available', rowIndex: 0, colIndex: 1 },
  { id: 's3', code: 'B1', stallType: 'standard', pricePaise: 200000, status: 'booked', rowIndex: 1, colIndex: 0 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (api.getStalls as jest.Mock).mockResolvedValue({ data: { data: { stalls } } });
  useEventsStore.setState({ stalls, loading: false, error: false });
});

const renderScreen = () =>
  render(<StallBookingScreen eventId="e1" eventTitle="Independence Day" onBack={jest.fn()} onBooked={jest.fn()} />);

describe('platformFeePaise', () => {
  // Must agree with lib/money.js on the server, which rounds to whole rupees.
  it('FR-STL-04: is 3% of the stall fee, rounded to a whole rupee', () => {
    expect(platformFeePaise(200000)).toBe(6000);
    expect(platformFeePaise(500000)).toBe(15000);
  });

  it('FR-STL-04: rounds to the nearest rupee rather than leaving stray paise', () => {
    expect(platformFeePaise(133300) % 100).toBe(0);
  });
});

describe('StallBookingScreen', () => {
  it('FR-STL-01: shows live availability', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('availability').props.children.join('')).toContain('2 of 3'));
  });

  it('FR-STL-01: a booked stall cannot be selected', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('stall-B1').props.accessibilityState.disabled).toBe(true));
  });

  it('FR-STL-02: marks the tapped stall selected', async () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('stall-A1'));
    await waitFor(() => expect(getByTestId('stall-A1').props.accessibilityState.selected).toBe(true));
  });

  it('FR-STL-03: selecting a second stall replaces the first', async () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByTestId('stall-A2'));
    await waitFor(() => {
      expect(getByTestId('stall-A1').props.accessibilityState.selected).toBe(false);
      expect(getByTestId('stall-A2').props.accessibilityState.selected).toBe(true);
    });
  });

  it('FR-STL-04: breaks out stall fee, platform fee and total', async () => {
    const { getByTestId, getByText } = renderScreen();
    fireEvent.press(getByTestId('stall-A1'));
    await waitFor(() => {
      expect(getByText('Platform fee (3%)')).toBeTruthy();
      expect(getByText(inr(200000))).toBeTruthy();
      expect(getByText(inr(6000))).toBeTruthy();
      expect(getByText(inr(206000))).toBeTruthy();
    });
  });

  // The single-winner index means the loser must be told what happened, not
  // shown a generic error.
  it('FR-STL-06: says the stall was just taken when the race is lost', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue({ response: { status: 409 } });
    const { getByTestId, getByText } = renderScreen();
    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByText(`Pay ${inr(206000)}`));
    await waitFor(() => expect(getByText(/just taken/i)).toBeTruthy());
  });

  it('FR-STL-07: confirms with the server before reporting success', async () => {
    (api.bookStall as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'o', payment_order_id: 'po1', amount: 206000, key_id: 'k', test_mode: true } },
    });
    payWithRazorpay.mockResolvedValue({ ok: true });
    confirmPayment.mockResolvedValue('paid');

    const onBooked = jest.fn();
    const { getByTestId, getByText } = render(
      <StallBookingScreen eventId="e1" eventTitle="Independence Day" onBack={jest.fn()} onBooked={onBooked} />
    );
    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByText(`Pay ${inr(206000)}`));

    await waitFor(() => expect(confirmPayment).toHaveBeenCalledWith('po1'));
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith('A1', 206000));
  });

  // Never show a confirmation the server has not agreed to.
  it('FR-STL-07: does not confirm a booking the webhook has not settled', async () => {
    (api.bookStall as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'o', payment_order_id: 'po1', amount: 206000, key_id: 'k', test_mode: true } },
    });
    payWithRazorpay.mockResolvedValue({ ok: true });
    confirmPayment.mockResolvedValue('pending');

    const onBooked = jest.fn();
    const { getByTestId, getByText } = render(
      <StallBookingScreen eventId="e1" eventTitle="Independence Day" onBack={jest.fn()} onBooked={onBooked} />
    );
    fireEvent.press(getByTestId('stall-A1'));
    fireEvent.press(getByText(`Pay ${inr(206000)}`));

    await waitFor(() => expect(getByText(/still confirming/i)).toBeTruthy());
    expect(onBooked).not.toHaveBeenCalled();
  });
});
