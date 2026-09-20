import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
}));

import ClaimPage from './page';

function typeCode(code: string) {
  fireEvent.change(screen.getByPlaceholderText('4K7QP2'), { target: { value: code } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('claim code entry', () => {
  it('carries the request intent through to the ticket page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionToken: 'tok-123' }),
    }));

    render(<ClaimPage />);
    typeCode('4K7QP2');
    fireEvent.click(screen.getByRole('button', { name: /request my car/i }));

    // The intent is what makes the single tap honest: the guest asked for the
    // car here, so the ticket page must not ask them again.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/tok-123?request=1'));
  });

  it('does not send anyone anywhere when the code is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<ClaimPage />);
    typeCode('BADCODE');
    fireEvent.click(screen.getByRole('button', { name: /request my car/i }));

    await screen.findByRole('alert');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
