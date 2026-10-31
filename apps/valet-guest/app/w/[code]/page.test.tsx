import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: '4K7QP2' }),
  useRouter: () => ({ replace: nav.replace }),
}));

import WhatsAppDoorPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = '919999900000';
});

describe('the door a scanned QR opens', () => {
  it('offers WhatsApp with the code already in the message', async () => {
    render(<WhatsAppDoorPage />);

    const link = await screen.findByRole('link', { name: /whatsapp/i });
    const href = link.getAttribute('href') || '';
    expect(href).toContain('wa.me/919999900000');
    expect(decodeURIComponent(href)).toContain('4K7QP2');
  });

  it('offers only WhatsApp, with no browser option, while a number is configured', async () => {
    render(<WhatsAppDoorPage />);

    await screen.findByRole('link', { name: /whatsapp/i });
    expect(screen.queryByRole('button', { name: /browser/i })).not.toBeInTheDocument();
  });

  it('falls back to the browser when no number is configured, so the guest is not stranded', async () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sessionToken: 'tok-1' }),
    }));

    render(<WhatsAppDoorPage />);
    fireEvent.click(await screen.findByRole('button', { name: /browser/i }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/tok-1'));
  });

  it('hides the WhatsApp door when no number is configured, rather than promising one', async () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

    render(<WhatsAppDoorPage />);

    // Offering a channel that cannot answer is worse than not offering it.
    expect(screen.queryByRole('link', { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /browser/i })).toBeInTheDocument();
  });

  it('says so when the code does not resolve, rather than dead-ending', async () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<WhatsAppDoorPage />);
    fireEvent.click(await screen.findByRole('button', { name: /browser/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
