jest.mock('../api/client');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import DonationCard from './DonationCard';
import type { DonationFund } from '../store/eventsStore';

function fund(overrides: Partial<DonationFund> = {}): DonationFund {
  return {
    id: 'f1', name: 'Ganesh Puja Fund 2025', description: 'Pandal and prasad',
    eventId: 'e1', targetPaise: 5000000, raisedPaise: 1250000, percent: 25, donorCount: 12,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.donate as jest.Mock).mockResolvedValue({ data: { data: { gatewayOrderId: 'order_test_1' } } });
});

describe('fund progress (FR-DON-02)', () => {
  it('shows raised, target, percent and donor count', () => {
    const { getByText } = render(<DonationCard fund={fund()} />);

    expect(getByText('₹12,500')).toBeTruthy();
    expect(getByText('of ₹50,000')).toBeTruthy();
    expect(getByText(/25% raised · 12 donors/)).toBeTruthy();
  });

  it('renders a progress bar', () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    expect(getByTestId('donation-progress')).toBeTruthy();
  });

  it('says "donor" not "donors" for a single donor', () => {
    const { getByText } = render(<DonationCard fund={fund({ donorCount: 1 })} />);

    expect(getByText(/1 donor$/)).toBeTruthy();
  });

  it('does not overflow the bar past 100%', () => {
    // An over-funded collection is a good problem, not a rendering bug.
    const { getByTestId } = render(
      <DonationCard fund={fund({ percent: 140, raisedPaise: 7000000 })} />
    );

    expect(getByTestId('donation-progress')).toBeTruthy();
  });
});

describe('quick amounts (FR-DON-03)', () => {
  it('offers the customary Indian offering denominations', () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    for (const a of [51, 101, 251, 501]) {
      expect(getByTestId(`donate-${a}`)).toBeTruthy();
    }
  });

  it('donates the selected quick amount in paise', async () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.press(getByTestId('donate-101'));
    fireEvent.press(getByTestId('donate-submit'));

    await waitFor(() => expect(api.donate).toHaveBeenCalledWith('f1', 10100));
  });

  it('supports a custom amount', async () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.changeText(getByTestId('donate-custom'), '750');
    fireEvent.press(getByTestId('donate-submit'));

    await waitFor(() => expect(api.donate).toHaveBeenCalledWith('f1', 75000));
  });

  it('rejects non-numeric input rather than sending a NaN amount', async () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.changeText(getByTestId('donate-custom'), 'abc');
    fireEvent.press(getByTestId('donate-submit'));

    expect(api.donate).not.toHaveBeenCalled();
  });

  it('will not donate zero', async () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.changeText(getByTestId('donate-custom'), '0');
    fireEvent.press(getByTestId('donate-submit'));

    expect(api.donate).not.toHaveBeenCalled();
  });

  it('a custom amount clears the selected quick amount', async () => {
    const { getByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.press(getByTestId('donate-101'));
    fireEvent.changeText(getByTestId('donate-custom'), '300');
    fireEvent.press(getByTestId('donate-submit'));

    await waitFor(() => expect(api.donate).toHaveBeenCalledWith('f1', 30000));
  });
});

describe('no platform fee (FR-DON-04)', () => {
  it('tells the resident that donations carry no platform fee', () => {
    const { getByText } = render(<DonationCard fund={fund()} />);

    // Stated in the UI, not just enforced in the schema — the resident has no
    // other way to know a cut is not being taken.
    expect(getByText(/no platform fee is charged on donations/i)).toBeTruthy();
  });

  it('never shows a fee line the way stall booking does', () => {
    const { queryByText } = render(<DonationCard fund={fund()} />);

    expect(queryByText(/platform fee \(3%\)/i)).toBeNull();
  });
});

describe('after donating', () => {
  it('thanks the donor and notifies the caller to refresh', async () => {
    const onDonated = jest.fn();
    const { getByTestId } = render(<DonationCard fund={fund()} onDonated={onDonated} />);

    fireEvent.press(getByTestId('donate-51'));
    fireEvent.press(getByTestId('donate-submit'));

    await waitFor(() => expect(getByTestId('donation-thanks')).toBeTruthy());
    expect(onDonated).toHaveBeenCalled();
  });

  it('reports a failure instead of implying the money went through', async () => {
    (api.donate as jest.Mock).mockRejectedValue(new Error('gateway down'));
    const { getByTestId, queryByTestId } = render(<DonationCard fund={fund()} />);

    fireEvent.press(getByTestId('donate-51'));
    fireEvent.press(getByTestId('donate-submit'));

    await waitFor(() => expect(getByTestId('donation-error')).toBeTruthy());
    expect(queryByTestId('donation-thanks')).toBeNull();
  });
});
