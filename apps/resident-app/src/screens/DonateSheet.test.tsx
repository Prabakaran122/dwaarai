import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DonateSheet, { QUICK_AMOUNTS, progressPercent, parseCustomAmount } from './DonateSheet';
import * as api from '../api/client';

jest.mock('../api/client');
jest.mock('../lib/checkout', () => ({
  payWithRazorpay: jest.fn(),
  confirmPayment: jest.fn(),
}));

const { payWithRazorpay, confirmPayment } = require('../lib/checkout');

const fund = {
  id: 'f1', name: 'Ganesh Puja Fund 2026', description: 'Community celebration',
  targetPaise: 5000000, raisedPaise: 1250000, eventId: 'e1', isOpen: true,
};

beforeEach(() => jest.clearAllMocks());

const renderSheet = (onDonated = jest.fn()) =>
  render(<DonateSheet fund={fund} onClose={jest.fn()} onDonated={onDonated} />);

describe('progressPercent', () => {
  it('FR-DON-02: reports progress toward the target', () => {
    expect(progressPercent(1250000, 5000000)).toBe(25);
  });

  // A bar running past the end of the card reads as a rendering bug.
  it('FR-DON-02: caps an overshooting fund at 100', () => {
    expect(progressPercent(6000000, 5000000)).toBe(100);
  });

  it('FR-DON-02: does not divide by a zero target', () => {
    expect(progressPercent(100, 0)).toBe(0);
  });
});

describe('parseCustomAmount', () => {
  it('FR-DON-03: converts rupees to paise', () => {
    expect(parseCustomAmount('750')).toBe(75000);
  });

  // Indian grouping is what people actually type into an amount field.
  it('FR-DON-03: ignores currency symbols and digit grouping', () => {
    expect(parseCustomAmount('₹1,000')).toBe(100000);
    expect(parseCustomAmount(' 250 ')).toBe(25000);
  });

  it('FR-DON-03: rejects nonsense and zero', () => {
    expect(parseCustomAmount('abc')).toBeNull();
    expect(parseCustomAmount('0')).toBeNull();
  });
});

describe('DonateSheet', () => {
  it('FR-DON-03: offers the four quick amounts and a custom field', () => {
    const { getByText, getByPlaceholderText } = renderSheet();
    ['₹51', '₹101', '₹251', '₹501'].forEach((label) => expect(getByText(label)).toBeTruthy());
    expect(getByPlaceholderText('Other amount')).toBeTruthy();
    expect(QUICK_AMOUNTS).toEqual([5100, 10100, 25100, 50100]);
  });

  it('FR-DON-02: renders progress toward the target', () => {
    expect(renderSheet().getByTestId('fund-progress')).toBeTruthy();
  });

  // Fee-free is a deliberate trust decision, not an omission.
  it('FR-DON-04: shows no platform fee, and says so', () => {
    const { queryByText, getByText } = renderSheet();
    expect(queryByText(/platform fee/i)).toBeNull();
    expect(getByText(/takes no fee on donations/i)).toBeTruthy();
  });

  it('FR-DON-03: a custom amount overrides the quick selection', async () => {
    const { getByPlaceholderText, getByText } = renderSheet();
    fireEvent.changeText(getByPlaceholderText('Other amount'), '750');
    await waitFor(() => expect(getByText('Donate ₹750.00')).toBeTruthy());
  });

  it('FR-DON-05: confirms with the server before reporting the donation', async () => {
    (api.donate as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'o', payment_order_id: 'po1', amount: 10100, key_id: 'k', test_mode: true } },
    });
    payWithRazorpay.mockResolvedValue({ ok: true });
    confirmPayment.mockResolvedValue('paid');

    const onDonated = jest.fn();
    const { getByText } = renderSheet(onDonated);
    fireEvent.press(getByText('Donate ₹101.00'));

    await waitFor(() => expect(onDonated).toHaveBeenCalledWith(10100));
  });

  it('FR-DON-05: does not claim a donation the webhook has not settled', async () => {
    (api.donate as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'o', payment_order_id: 'po1', amount: 10100, key_id: 'k', test_mode: true } },
    });
    payWithRazorpay.mockResolvedValue({ ok: true });
    confirmPayment.mockResolvedValue('pending');

    const onDonated = jest.fn();
    const { getByText } = renderSheet(onDonated);
    fireEvent.press(getByText('Donate ₹101.00'));

    await waitFor(() => expect(getByText(/confirming/i)).toBeTruthy());
    expect(onDonated).not.toHaveBeenCalled();
  });
});
