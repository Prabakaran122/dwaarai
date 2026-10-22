import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SignedMediaLinks, fetchMediaLinks, absoluteMediaUrl,
  MEDIA_LINK_TTL_MS, MEDIA_LINK_REFRESH_MARGIN_MS,
} from './mediaLinks';

const originalFetch = global.fetch;

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Test',
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The condition photos were plain <img src> at an auth-required route, and an
// <img> sends no Authorization header -- so every tile on the dispute view
// was a broken image.
describe('fetchMediaLinks', () => {
  it('asks the admin route with the admin credentials and the picked property', async () => {
    localStorage.setItem('cg_admin_token', 'jwt-1');
    localStorage.setItem('cg_selected_community_id', 'palm-meadows');
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {
      links: { m1: '/admin/media-links/sig-1' },
    }));

    await fetchMediaLinks('tok-9');

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('http://localhost:3060/admin/tickets/tok-9/media-links');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
    expect(headers['X-Community-Id']).toBe('palm-meadows');
  });

  it('prefixes a relative link with the valet API base, leaves an absolute one alone', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {
      links: {
        m1: '/admin/media-links/sig-1',
        m2: 'https://cdn.example/x.jpg',
        bad: null,
      },
    }));

    const links = await fetchMediaLinks('tok');

    expect(links).toEqual({
      m1: 'http://localhost:3060/admin/media-links/sig-1',
      m2: 'https://cdn.example/x.jpg',
    });
  });

  it('joins without doubling or dropping the slash', () => {
    expect(absoluteMediaUrl('/a/b', 'https://h/valet-api/')).toBe('https://h/valet-api/a/b');
    expect(absoluteMediaUrl('a/b', 'https://h/valet-api')).toBe('https://h/valet-api/a/b');
  });
});

describe('SignedMediaLinks', () => {
  it('loads, then hands each tile its signed URL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ m1: 'https://v/l/1' });
    const links = new SignedMediaLinks(fetcher);

    expect(links.get('m1')).toEqual({ state: 'loading' });
    await links.refresh();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(links.get('m1')).toEqual({ state: 'ready', url: 'https://v/l/1' });
    links.dispose();
  });

  it('fetches a fresh link when an image errors (the old one expired)', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ m1: 'https://v/l/old' })
      .mockResolvedValueOnce({ m1: 'https://v/l/new' });
    const links = new SignedMediaLinks(fetcher);
    const listener = vi.fn();
    links.subscribe(listener);
    await links.refresh();

    await links.reportError('m1');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(links.get('m1')).toEqual({ state: 'ready', url: 'https://v/l/new' });
    expect(listener).toHaveBeenCalled();
    links.dispose();
  });

  it('shares one request between tiles that fail together', async () => {
    const fetcher = vi.fn().mockResolvedValue({ m1: 'a', m2: 'b' });
    const links = new SignedMediaLinks(fetcher);
    await links.refresh();

    await Promise.all([links.reportError('m1'), links.reportError('m2')]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    links.dispose();
  });

  it('shows a per-tile error when even a fresh link fails, and retry recovers it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ m1: 'https://v/l/1', m2: 'https://v/l/2' });
    const links = new SignedMediaLinks(fetcher);
    await links.refresh();

    await links.reportError('m1'); // renewed
    await links.reportError('m1'); // failed again on the fresh link

    expect(links.get('m1').state).toBe('error');
    // Only that tile: its neighbour is unaffected.
    expect(links.get('m2')).toEqual({ state: 'ready', url: 'https://v/l/2' });

    await links.retry('m1');
    expect(links.get('m1')).toEqual({ state: 'ready', url: 'https://v/l/1' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    links.dispose();
  });

  it('reports a failed link request on the tiles instead of a broken image', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ m1: 'https://v/l/1' });
    const links = new SignedMediaLinks(fetcher);

    await links.refresh();
    const failed = links.get('m1');
    expect(failed.state).toBe('error');
    expect(failed.state === 'error' && failed.message).toMatch(/Could not load this photo/);

    await links.retry('m1');
    expect(links.get('m1')).toEqual({ state: 'ready', url: 'https://v/l/1' });
    links.dispose();
  });

  it('says a photo is gone when the service no longer signs it', async () => {
    const links = new SignedMediaLinks(vi.fn().mockResolvedValue({}));
    await links.refresh();
    expect(links.get('m1').state).toBe('error');
    links.dispose();
  });

  it('renews ahead of expiry while a tile is still waiting on its link', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ m1: 'one' })
      .mockResolvedValueOnce({ m1: 'two' });
    const links = new SignedMediaLinks(fetcher);
    await links.refresh();

    await vi.advanceTimersByTimeAsync(MEDIA_LINK_TTL_MS - MEDIA_LINK_REFRESH_MARGIN_MS);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(links.get('m1')).toEqual({ state: 'ready', url: 'two' });
    links.dispose();
  });

  it('does not renew once every photo is on screen', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ m1: 'one' });
    const links = new SignedMediaLinks(fetcher);
    await links.refresh();
    links.markLoaded('m1');

    await vi.advanceTimersByTimeAsync(MEDIA_LINK_TTL_MS * 3);

    expect(fetcher).toHaveBeenCalledTimes(1);
    links.dispose();
  });

  it('stops renewing after the page goes away', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ m1: 'one' });
    const links = new SignedMediaLinks(fetcher);
    await links.refresh();
    links.dispose();

    await vi.advanceTimersByTimeAsync(MEDIA_LINK_TTL_MS * 3);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
