import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from './api';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? 'Conflict' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.setItem('cg_admin_token', 'test-token');
  global.fetch = vi.fn();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('apiFetch error reporting', () => {
  it('surfaces the message the server sent', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(409, {
        success: false,
        error: { message: 'Palm Meadows still has 25 residents, 13 units.' },
      })
    );

    // The counts are the entire reason the server bothers to compose that
    // sentence. "API error: 409 Conflict" sends somebody hunting through five
    // screens to find out what is actually in the way.
    await expect(apiFetch('/admin/communities/c1', { method: 'DELETE' }))
      .rejects.toThrow('Palm Meadows still has 25 residents, 13 units.');
  });

  it('still reports something useful when the body is not JSON', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('not json'); },
    } as unknown as Response);

    await expect(apiFetch('/anything')).rejects.toThrow(/502/);
  });

  it('still reports something useful when the JSON carries no message', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(500, { success: false }));
    await expect(apiFetch('/anything')).rejects.toThrow(/500/);
  });
});

describe('a 401 while already on the login page', () => {
  const realLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true });
  });

  function stubLocation(pathname: string) {
    const assigned: string[] = [];
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname,
        get href() { return `https://dwaarai.com${pathname}`; },
        set href(v: string) { assigned.push(v); },
        assigned,
      },
    });
    return assigned;
  }

  it('does not navigate when the login page is what returned 401', async () => {
    const assigned = stubLocation('/admin/login');
    localStorage.setItem('cg_admin_token', 'expired');
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}),
    } as unknown as Response);

    await expect(apiFetch('/entitlements')).rejects.toThrow();

    // Assigning location.href on the page you are already on is a full reload.
    // Anything that fetches on mount then turns that into an endless refresh,
    // which is exactly what the portal did on its own login screen.
    expect(assigned).toEqual([]);
  });

  it('still sends a signed-out user to the login page from elsewhere', async () => {
    const assigned = stubLocation('/admin/valet');
    localStorage.setItem('cg_admin_token', 'expired');
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}),
    } as unknown as Response);

    await expect(apiFetch('/entitlements')).rejects.toThrow();

    expect(assigned).toEqual(['/admin/login']);
  });

  it('clears the stored session either way', async () => {
    stubLocation('/admin/login');
    localStorage.setItem('cg_admin_token', 'expired');
    localStorage.setItem('cg_admin_user', '{}');
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}),
    } as unknown as Response);

    await expect(apiFetch('/entitlements')).rejects.toThrow();

    expect(localStorage.getItem('cg_admin_token')).toBeNull();
    expect(localStorage.getItem('cg_admin_user')).toBeNull();
  });
});
