import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
}));

// The request intent rides in on the URL, so the tests drive the real address
// bar rather than a mocked hook.
function arriveAt(search: string) {
  window.history.replaceState({}, '', `/v/test-token${search}`);
}

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    getTicket: vi.fn(),
    requestCar: vi.fn(),
    getRotatingQr: vi.fn(),
    claimDiscount: vi.fn(),
    submitFeedback: vi.fn(),
  };
});

import GuestPage from './page';
import { getTicket, requestCar, getRotatingQr, submitFeedback, GuestTicket, GuestError } from '@/lib/api';

const baseTicket: GuestTicket = {
  displayId: 'DWR-0001',
  plate: 'KA03NJ0435',
  vehicleMake: 'Maruti Swift',
  venueName: 'Prestige Lakeside',
  status: 'parked',
  elapsedMinutes: 12,
  guardName: null,
  etaSeconds: null,
  dropOffGuardName: 'Ramesh',
  handedOver: false,
  hasVenueLogo: false,
  hasCard: false,
  promo: null,
};

const mockGetTicket = vi.mocked(getTicket);
const mockRequestCar = vi.mocked(requestCar);
const mockGetQr = vi.mocked(getRotatingQr);

beforeEach(() => {
  vi.clearAllMocks();
  arriveAt('');
  mockGetQr.mockResolvedValue({
    qrDataUrl: 'data:image/png;base64,QR',
    expiresAt: new Date(Date.now() + 18000).toISOString(),
    ttlSeconds: 18,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('guest page states', () => {
  it('shows the vehicle and a request button while parked', async () => {
    mockGetTicket.mockResolvedValue(baseTicket);

    render(<GuestPage />);

    expect(await screen.findByText('KA03NJ0435')).toBeInTheDocument();
    expect(screen.getByText('Maruti Swift')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request my car/i })).toBeInTheDocument();
  });

  it('offers the request button again on a multi-day ticket parked after a pickup', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'parked_again' });

    render(<GuestPage />);

    expect(await screen.findByRole('button', { name: /request my car/i })).toBeInTheDocument();
  });

  it('confirms the request instead of offering it again once requested', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'requested' });

    render(<GuestPage />);

    expect(await screen.findByText(/request received/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request my car/i })).not.toBeInTheDocument();
  });

  it('shows the countdown and the assigned valet while en route', async () => {
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'en_route', guardName: 'Suresh', etaSeconds: 285,
    });

    render(<GuestPage />);

    expect(await screen.findByText(/on its way/i)).toBeInTheDocument();
    expect(screen.getByText('4:45')).toBeInTheDocument();
    expect(screen.getByText('Suresh')).toBeInTheDocument();
  });

  it('says the page will update, with no countdown, when the valet skipped the ETA', async () => {
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'en_route', guardName: 'Suresh', etaSeconds: null,
    });

    render(<GuestPage />);

    expect(await screen.findByText(/update the moment it arrives/i)).toBeInTheDocument();
  });

  it('shows "any moment now" rather than a negative number once the estimate elapses', async () => {
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'en_route', guardName: 'Suresh', etaSeconds: 0,
    });

    render(<GuestPage />);

    expect(await screen.findByText('0:00')).toBeInTheDocument();
    expect(screen.getByText(/any moment now/i)).toBeInTheDocument();
  });

  it('shows the rotating pickup QR once the car has arrived', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'arrived', guardName: 'Suresh' });

    render(<GuestPage />);

    const qr = await screen.findByAltText('Pickup QR code');
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QR');
  });

  it('does not request a pickup QR before the car has arrived', async () => {
    mockGetTicket.mockResolvedValue(baseTicket);

    render(<GuestPage />);
    await screen.findByText('KA03NJ0435');

    expect(mockGetQr).not.toHaveBeenCalled();
  });

  it('thanks the guest and offers the discount once finally closed', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'final_closed' });

    render(<GuestPage />);

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText(/get a discount for next time/i)).toBeInTheDocument();
  });

  it('does not ask for a phone number until the guest opts in', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'final_closed' });

    render(<GuestPage />);
    await screen.findByText(/thank you/i);

    // If the guest never taps the offer, no number is ever requested.
    expect(screen.queryByLabelText(/mobile number/i)).not.toBeInTheDocument();
  });

  it('explains an expired ticket', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'expired' });

    render(<GuestPage />);

    expect(await screen.findByText(/this ticket has closed/i)).toBeInTheDocument();
  });
});

describe('unknown tokens', () => {
  it('shows the same generic message a closed ticket would show', async () => {
    mockGetTicket.mockRejectedValue(new GuestError(404, 'not_found', 'nope'));

    render(<GuestPage />);

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it('does not reveal whether the token ever existed', async () => {
    mockGetTicket.mockRejectedValue(new GuestError(404, 'not_found', 'nope'));

    render(<GuestPage />);
    await screen.findByText(/invalid or has expired/i);

    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expired ticket/i)).not.toBeInTheDocument();
  });
});

describe('staff identification', () => {
  it('always offers the drop-off valet\'s ID', async () => {
    mockGetTicket.mockResolvedValue(baseTicket);

    render(<GuestPage />);
    await screen.findByText('KA03NJ0435');

    expect(screen.getByText('Ramesh')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view id/i })).toHaveLength(1);
  });

  it('offers both valets once a different one is bringing the car', async () => {
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'en_route', guardName: 'Suresh', etaSeconds: 120,
    });

    render(<GuestPage />);
    await screen.findByText(/on its way/i);

    expect(screen.getAllByRole('button', { name: /view id/i })).toHaveLength(2);
  });
});

describe('live updates', () => {
  it('re-reads the ticket on an interval so the page follows the valet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetTicket.mockResolvedValue(baseTicket);

    render(<GuestPage />);
    await waitFor(() => expect(mockGetTicket).toHaveBeenCalledTimes(1));

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    expect(mockGetTicket.mock.calls.length).toBeGreaterThan(1);
  });
});

// The window the guest gets to call it off, in ms — mirrors CANCEL_WINDOW_MS
// in the page. Stated here as the behaviour under test: three seconds is a
// promise to the guest, not an implementation detail.
const CANCEL_WINDOW_MS = 3000;

describe('arriving from the claim code with the request intent', () => {
  it('requests the car on its own once the cancel window closes', async () => {
    arriveAt('?request=1');
    mockGetTicket.mockResolvedValue(baseTicket);
    mockRequestCar.mockResolvedValue({ ...baseTicket, status: 'requested' });
    vi.useFakeTimers();

    render(<GuestPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // The window is the whole point: nothing is sent while it is open.
    expect(mockRequestCar).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(CANCEL_WINDOW_MS); });

    expect(mockRequestCar).toHaveBeenCalledWith('test-token');
  });

  it('never requests the car when the guest cancels inside the window', async () => {
    arriveAt('?request=1');
    mockGetTicket.mockResolvedValue(baseTicket);
    vi.useFakeTimers();

    render(<GuestPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(CANCEL_WINDOW_MS * 3); });

    expect(mockRequestCar).not.toHaveBeenCalled();
  });

  it('ignores the intent when the car is already on its way', async () => {
    arriveAt('?request=1');
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'en_route', guardName: 'Suresh', etaSeconds: 120,
    });
    vi.useFakeTimers();

    render(<GuestPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(CANCEL_WINDOW_MS * 3); });

    expect(mockRequestCar).not.toHaveBeenCalled();
  });
});

describe('the handover moment', () => {
  // The guard scans, then photographs the car before confirming pickup. The
  // guest is already in the driver's seat, so the thank-you has to land on the
  // scan or it lands in a pocket.
  const handedOver = { ...baseTicket, status: 'arrived' as const, guardName: 'Suresh', handedOver: true };

  it('thanks the guest on the scan, without waiting for the guard to close the ticket', async () => {
    mockGetTicket.mockResolvedValue(handedOver);

    render(<GuestPage />);

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText(/get a discount for next time/i)).toBeInTheDocument();
  });

  it('drops the pickup QR once it has been scanned', async () => {
    mockGetTicket.mockResolvedValue(handedOver);

    render(<GuestPage />);
    await screen.findByText(/thank you/i);

    expect(screen.queryByAltText('Pickup QR code')).not.toBeInTheDocument();
    expect(mockGetQr).not.toHaveBeenCalled();
  });

  it('still shows the QR while the car waits to be collected', async () => {
    mockGetTicket.mockResolvedValue({ ...handedOver, handedOver: false });

    render(<GuestPage />);

    expect(await screen.findByAltText('Pickup QR code')).toBeInTheDocument();
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  });
});

describe('the thank-you screen', () => {
  const done = { ...baseTicket, status: 'final_closed' as const };

  it('leads with the venue logo when the venue has uploaded one', async () => {
    mockGetTicket.mockResolvedValue({ ...done, hasVenueLogo: true });

    render(<GuestPage />);

    const logo = await screen.findByAltText('Prestige Lakeside');
    expect(logo.getAttribute('src')).toContain('/guest/tickets/test-token/venue-logo');
  });

  it('sets the venue name in type when there is no logo — a wordmark either way', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);

    expect(await screen.findByTestId('venue-wordmark')).toHaveTextContent('Prestige Lakeside');
    expect(screen.queryByAltText('Prestige Lakeside')).not.toBeInTheDocument();
  });

  it('asks for the card back only from a guest who was given one', async () => {
    mockGetTicket.mockResolvedValue({ ...done, hasCard: true });

    render(<GuestPage />);

    expect(await screen.findByText(/return the card/i)).toBeInTheDocument();
  });

  it('says nothing about a card to a guest who scanned the screen', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);
    await screen.findByText(/thank you for visiting/i);

    expect(screen.queryByText(/return the card/i)).not.toBeInTheDocument();
  });

  it('shows the ticket number, which is what the desk will ask for', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);

    expect(await screen.findByText(/DWR-0001/)).toBeInTheDocument();
  });

  it('carries the Powered by DwaarAI mark and the legal links', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);

    expect(await screen.findByAltText('DwaarAI')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /terms/i })).toBeInTheDocument();
  });

  it('stops saying a car is being brought once the guest has it', async () => {
    mockGetTicket.mockResolvedValue({
      ...baseTicket, status: 'arrived' as const, guardName: 'Suresh', handedOver: true,
    });

    render(<GuestPage />);
    await screen.findByText(/thank you for visiting/i);

    // "Bringing your car" over a thank-you note is a car already in the
    // guest's hands being described as still on its way.
    expect(screen.queryByText(/bringing your car/i)).not.toBeInTheDocument();
    expect(screen.getByText(/brought by/i)).toBeInTheDocument();
  });
});

describe('how the trip went', () => {
  const done = { ...baseTicket, status: 'final_closed' as const };

  it('asks once the trip is over, and not before', async () => {
    mockGetTicket.mockResolvedValue({ ...baseTicket, status: 'parked' as const });

    render(<GuestPage />);
    await screen.findByRole('button', { name: /request my car/i });

    expect(screen.queryByRole('button', { name: /satisfied/i })).not.toBeInTheDocument();
  });

  it('records a happy tap without asking anything further', async () => {
    mockGetTicket.mockResolvedValue(done);
    vi.mocked(submitFeedback).mockResolvedValue({ recorded: true });

    render(<GuestPage />);
    fireEvent.click(await screen.findByTestId('feedback-yes'));

    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith('test-token', true, []));
    // Nothing more is asked of a guest who is happy.
    expect(await screen.findByText(/thanks for letting us know/i)).toBeInTheDocument();
  });

  it('asks what went wrong only when the guest says it did', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);
    fireEvent.click(await screen.findByTestId('feedback-no'));

    expect(await screen.findByText(/long wait/i)).toBeInTheDocument();
    // Not sent yet — the chips are the point of the second tap.
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('sends the chips the guest picked', async () => {
    mockGetTicket.mockResolvedValue(done);
    vi.mocked(submitFeedback).mockResolvedValue({ recorded: true });

    render(<GuestPage />);
    fireEvent.click(await screen.findByTestId('feedback-no'));
    fireEvent.click(await screen.findByTestId('reason-long_wait'));
    fireEvent.click(screen.getByTestId('feedback-send'));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith('test-token', false, ['long_wait'])
    );
  });
});

describe('the venue promo on the receipt', () => {
  const done = { ...baseTicket, status: 'final_closed' as const };

  it('shows it, linked, when the venue has one', async () => {
    mockGetTicket.mockResolvedValue({
      ...done, promo: { label: 'Spa offer — 20% off', link: 'https://example.com/spa' },
    });

    render(<GuestPage />);

    const link = await screen.findByRole('link', { name: /spa offer/i });
    expect(link).toHaveAttribute('href', 'https://example.com/spa');
    // Someone else's site: never handed the referrer or window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders it as plain text when there is no link', async () => {
    mockGetTicket.mockResolvedValue({ ...done, promo: { label: 'Ask about our spa', link: null } });

    render(<GuestPage />);

    expect(await screen.findByText(/ask about our spa/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ask about our spa/i })).not.toBeInTheDocument();
  });

  it('shows nothing at all for a venue without advertising', async () => {
    mockGetTicket.mockResolvedValue(done);

    render(<GuestPage />);
    await screen.findByText(/thank you for visiting/i);

    expect(screen.queryByTestId('venue-promo')).not.toBeInTheDocument();
  });
});
