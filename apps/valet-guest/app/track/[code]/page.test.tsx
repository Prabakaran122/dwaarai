import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: '4k7qp2' }),
  useRouter: () => ({ replace: nav.replace }),
}));

import TrackPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('the link sent to a guest on WhatsApp', () => {
  it('goes straight to the live page, with no door in between', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: 'sess-abc', venueName: 'Palm Meadows' }),
    } as Response);

    render(<TrackPage />);

    // The whole point. A guest who is already inside WhatsApp and tapped a
    // link must not be offered a button that opens WhatsApp.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/sess-abc'));
    expect(screen.queryByRole('link', { name: /whatsapp/i })).toBeNull();
  });

  it('resolves the code case-insensitively', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: 's1' }),
    } as Response);

    render(<TrackPage />);

    // Lowercased by WhatsApp's own link preview, retyped by hand, pasted from
    // a bill -- the code that arrives is not always the code that was issued.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain('4K7QP2');
  });

  it('never puts the session token anywhere a forwarded message could carry it', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: 'sess-abc' }),
    } as Response);

    render(<TrackPage />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    // The address a guest can forward holds the claim code, which stops
    // resolving when the ticket closes. The token only ever appears after
    // this redirect, in that guest's own browser.
    const requested = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(requested).not.toContain('sess-abc');
  });

  it('says the stay is over rather than showing a broken page', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    render(<TrackPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('survives the network being down without redirecting anywhere', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));

    render(<TrackPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
