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
