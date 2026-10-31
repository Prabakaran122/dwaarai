import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ community: '11111111-1111-1111-1111-111111111111', code: 'A047' }),
  useRouter: () => ({ replace: nav.replace }),
}));

import CardPage from './page';

const resolvesTo = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = '919999900000';
  resolvesTo({ waRef: 'H7M2QP', sessionToken: 'tok-9' });
});

describe('the card the guard scanned, now shown to the guest', () => {
  it('offers WhatsApp carrying the card reference, not its printed code', async () => {
    render(<CardPage />);

    const href = decodeURIComponent(
      (await screen.findByRole('link', { name: /whatsapp/i })).getAttribute('href') || ''
    );
    // "A047" is unique per venue only, and a WhatsApp message carries no venue.
    expect(href).toContain('H7M2QP');
    expect(href).not.toContain('A047');
  });

  it('no longer redirects straight past the guest to the ticket page', async () => {
    render(<CardPage />);
    await screen.findByRole('link', { name: /whatsapp/i });

    // The choice is the whole point of the card being in the guest's hand.
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('offers only WhatsApp, with no browser option, while a number is configured', async () => {
    render(<CardPage />);
    await screen.findByRole('link', { name: /whatsapp/i });

    expect(screen.queryByRole('button', { name: /browser/i })).not.toBeInTheDocument();
  });

  it('falls back to the browser when no number is configured', async () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

    render(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: /browser/i }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/tok-9'));
  });

  it('still offers WhatsApp when the car is not checked in yet', async () => {
    resolvesTo({ waRef: 'H7M2QP', sessionToken: null });

    render(<CardPage />);

    // The common case in this flow: the guard scanned to start intake and
    // handed the card straight over.
    expect(await screen.findByRole('link', { name: /whatsapp/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browser/i })).not.toBeInTheDocument();
  });

  // A card with no car on it said "Your car is with us" -- to a guest who had
  // just checked out and kept the card, and to one who scanned before intake
  // finished. Only a card with a ticket on it may say the car is here.
  it('does not claim the car is here when no ticket is on the card', async () => {
    resolvesTo({ waRef: 'H7M2QP', sessionToken: null });

    render(<CardPage />);

    expect(await screen.findByText(/no car is on this card yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/your car is with us/i)).not.toBeInTheDocument();
  });

  it('says the car is here once a ticket is on the card', async () => {
    render(<CardPage />);

    expect(await screen.findByText(/your car is with us/i)).toBeInTheDocument();
  });

  it('keeps checking, and offers the browser fallback the moment check-in completes', async () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: null }) })
      .mockResolvedValue({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: 'tok-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);
    await screen.findByText(/no car is on this card yet/i);
    await vi.advanceTimersByTimeAsync(6000);

    expect(await screen.findByRole('button', { name: /browser/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('says so when the card was never registered here', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<CardPage />);

    expect(await screen.findByText(/isn.t active right now/i)).toBeInTheDocument();
  });
});

// Card codes are sequential and printed, so the server binds a card to the
// first phone that opens it while a car is on it (guest.js, migration 072).
describe('a card bound to another phone', () => {
  it('sends this browser\'s device id with the lookup, the same one every time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: 'tok-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);
    await screen.findByRole('link', { name: /whatsapp/i });
    render(<CardPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const ids = fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['X-Valet-Device']);
    expect(ids[0]).toMatch(/^[A-Za-z0-9-]{16,128}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it('still looks the card up when storage throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: 'tok-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);

    expect(await screen.findByRole('link', { name: /whatsapp/i })).toBeInTheDocument();
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['X-Valet-Device']).toBeTruthy();
    getItem.mockRestore();
  });

  it('says the card is open elsewhere and offers the claim code, not the ticket', async () => {
    resolvesTo({ sessionToken: null, locked: true, venueName: 'The Leela Palace', status: 'parked' });

    render(<CardPage />);

    expect(await screen.findByText(/already open on another phone/i)).toBeInTheDocument();
    expect(screen.getByText(/6-character code from your SMS or WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/6-character code/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browser/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/your car is with us/i)).not.toBeInTheDocument();
  });

  it('opens the ticket from the claim code without asking for the car', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionToken: null, locked: true, venueName: null, status: 'parked' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionToken: 'tok-claimed', venueName: null }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);
    fireEvent.change(await screen.findByLabelText(/6-character code/i), { target: { value: 'B73V5M' } });
    fireEvent.click(screen.getByRole('button', { name: /show my car/i }));

    // No ?request=1: proving who you are must not summon the car.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/tok-claimed'));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/guest/claim/B73V5M');
  });

  it('does not keep polling a locked card', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionToken: null, locked: true, venueName: null, status: 'parked' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);
    await screen.findByText(/already open on another phone/i);
    await vi.advanceTimersByTimeAsync(30000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('a car out with a multi-day guest', () => {
  it('says the car is with them, not with us', async () => {
    resolvesTo({ waRef: 'H7M2QP', sessionToken: 'tok-9', status: 'with_guest', locked: false });

    render(<CardPage />);

    expect(await screen.findByText(/your car is with you/i)).toBeInTheDocument();
    expect(screen.queryByText(/your car is with us/i)).not.toBeInTheDocument();
  });
});

describe('a lookup that fails for some reason other than the card', () => {
  it('says it could not connect, not that the card is inactive, and retries on request', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: 'tok-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);

    expect(await screen.findByText(/couldn.t reach the valet desk/i)).toBeInTheDocument();
    expect(screen.queryByText(/isn.t active right now/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/your car is with us/i)).toBeInTheDocument();
  });

  it('treats a rate limit as a load error too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ error: 'rate_limited', message: 'Too many' }),
    }));

    render(<CardPage />);

    expect(await screen.findByText(/couldn.t reach the valet desk/i)).toBeInTheDocument();
  });

  it('keeps trying by itself after a failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, json: async () => ({ waRef: 'H7M2QP', sessionToken: 'tok-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardPage />);
    await screen.findByText(/couldn.t reach the valet desk/i);
    await vi.advanceTimersByTimeAsync(16000);

    expect(await screen.findByText(/your car is with us/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
