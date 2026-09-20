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

  it('opens the ticket for a guest who picks the browser', async () => {
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

  it('says so when the card was never registered here', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<CardPage />);

    expect(await screen.findByText(/isn.t active right now/i)).toBeInTheDocument();
  });
});
