import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    getTicket: vi.fn(),
    requestCar: vi.fn(),
    getRotatingQr: vi.fn(),
    claimDiscount: vi.fn(),
  };
});

import GuestPage from './page';
import { getTicket, getRotatingQr, GuestTicket, GuestError } from '@/lib/api';

const baseTicket: GuestTicket = {
  displayId: 'SRT-0001',
  plate: 'KA03NJ0435',
  vehicleMake: 'Maruti Swift',
  venueName: 'Prestige Lakeside',
  status: 'parked',
  elapsedMinutes: 12,
  guardName: null,
  etaSeconds: null,
  dropOffGuardName: 'Ramesh',
};

const mockGetTicket = vi.mocked(getTicket);
const mockGetQr = vi.mocked(getRotatingQr);

beforeEach(() => {
  vi.clearAllMocks();
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
