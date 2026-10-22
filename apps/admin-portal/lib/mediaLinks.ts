/**
 * Signed links for a ticket's condition photos and videos.
 *
 * The media route needs an admin token, and an <img>/<video> sends none, so a
 * plain `src` pointing at it 401'd and every tile on the dispute view was a
 * broken image -- the one screen whose whole purpose is to show them. The same
 * fix the valet app uses for the guest photo: ask valet-service for links
 * signed per media item (`POST /admin/tickets/:token/media-links`), which load
 * with no credential and stay valid for about two minutes.
 *
 * Two minutes means a page left open goes stale, so this keeps the links
 * fresh: once on a timer ahead of expiry (only while some tile still has not
 * loaded -- a photo already on screen does not need a new URL), and again
 * whenever a tile reports a load error. A tile that fails on a link fetched
 * after its own error is genuinely broken and is shown as such, with a retry.
 */

import { valetPost, VALET_BASE } from './valet';

/** How long the service signs a link for. */
export const MEDIA_LINK_TTL_MS = 120_000;
/** How far ahead of expiry the links are renewed. */
export const MEDIA_LINK_REFRESH_MARGIN_MS = 20_000;

/** The service may answer with a path on itself; an <img> needs the full URL. */
export function absoluteMediaUrl(url: string, base: string = VALET_BASE): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

export async function fetchMediaLinks(ticketToken: string): Promise<Record<string, string>> {
  const res = await valetPost<{ links?: Record<string, unknown> }>(
    `/admin/tickets/${ticketToken}/media-links`
  );
  const links: Record<string, string> = {};
  for (const [id, url] of Object.entries(res?.links ?? {})) {
    if (typeof url === 'string' && url) links[id] = absoluteMediaUrl(url);
  }
  return links;
}

export type MediaLinkState =
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'error'; message: string };

export class SignedMediaLinks {
  private links: Record<string, string> = {};
  private fetched = false;
  private fetchError: string | null = null;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  /** Tiles that have errored once and were given a fresh link since. */
  private retried = new Set<string>();
  private failed = new Map<string, string>();
  private loaded = new Set<string>();

  constructor(
    private readonly fetcher: () => Promise<Record<string, string>>,
    private readonly ttlMs: number = MEDIA_LINK_TTL_MS,
    private readonly marginMs: number = MEDIA_LINK_REFRESH_MARGIN_MS,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get(id: string): MediaLinkState {
    const failure = this.failed.get(id);
    if (failure) return { state: 'error', message: failure };
    const url = this.links[id];
    if (url) return { state: 'ready', url };
    if (this.fetchError) return { state: 'error', message: this.fetchError };
    if (!this.fetched) return { state: 'loading' };
    return { state: 'error', message: 'This photo is no longer available.' };
  }

  /** Fetch (or re-fetch) every link. Concurrent callers share one request. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const links = await this.fetcher();
        if (this.disposed) return;
        this.links = links;
        this.fetchError = null;
      } catch (err) {
        if (this.disposed) return;
        this.fetchError = err instanceof Error && err.message
          ? `Could not load this photo (${err.message}).`
          : 'Could not load this photo.';
      } finally {
        this.fetched = true;
        this.inflight = null;
        if (!this.disposed) {
          this.schedule();
          this.emit();
        }
      }
    })();
    return this.inflight;
  }

  /** A tile's media loaded; it keeps its URL and needs no renewal. */
  markLoaded(id: string) {
    this.loaded.add(id);
    this.retried.delete(id);
  }

  /** A tile's media failed to load: renew once, then give up on that tile. */
  reportError(id: string): Promise<void> {
    this.loaded.delete(id);
    if (this.failed.has(id)) return Promise.resolve();
    if (this.retried.has(id)) {
      this.failed.set(id, 'This photo did not load.');
      this.emit();
      return Promise.resolve();
    }
    this.retried.add(id);
    return this.refresh();
  }

  /** The tile's retry button: forget its failure and fetch fresh links. */
  retry(id: string): Promise<void> {
    this.failed.delete(id);
    this.retried.delete(id);
    this.loaded.delete(id);
    this.emit();
    return this.refresh();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Nothing still waiting on a link: let it lapse. A later load error
      // renews on demand.
      const pending = Object.keys(this.links).some((id) => !this.loaded.has(id));
      if (pending || this.fetchError) void this.refresh();
    }, Math.max(1_000, this.ttlMs - this.marginMs));
  }

  private emit() {
    for (const l of Array.from(this.listeners)) l();
  }
}
