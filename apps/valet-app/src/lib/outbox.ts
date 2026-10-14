import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNetworkFailure } from './connectivity';

/**
 * Work the app could not send yet.
 *
 * Condition photos first: they are the bulk of intake traffic, they already
 * upload one at a time by design, and unlike a ticket they need nothing minted
 * server-side -- so they can be replayed with no coordination at all.
 *
 * The semantics are lifted from edge/offline_queue.py rather than reinvented,
 * because that queue has been running at gates for a year:
 *
 *   - 400 and 422 are permanent. Those exact bytes are wrong, and will be
 *     wrong next time; retrying only burns battery and hides the problem.
 *   - Everything else -- 5xx, 401, a dead network -- is transient. A rotated
 *     token or a brief outage must not be able to destroy queued work.
 *   - After MAX_ATTEMPTS an entry is dropped rather than kept forever, so one
 *     unsendable photo cannot hold every photo behind it hostage.
 *
 * Each entry carries its own idempotency key, which is the whole reason the
 * server grew Idempotency-Key: without one, a reply lost on a flaky reconnect
 * means the same photo uploaded and counted twice.
 */

const KEY = 'dwaar_valet_outbox';

/** Matches the edge node. Three transient failures is a real outage, not a blip. */
export const MAX_ATTEMPTS = 3;

/** Statuses that mean these bytes will never be accepted. */
const PERMANENT = new Set([400, 422]);

export interface OutboxEntry {
  key: string;
  payload: Record<string, unknown>;
  attempts: number;
  queuedAt: number;
}

function newKey(): string {
  // Good enough for an idempotency key and available everywhere: no crypto
  // module, no uuid dependency pulled in for one call site.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readAll(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A half-written blob is the same as none. Returning something shaped
    // wrong would crash the drain that exists to recover from failure.
    return [];
  }
}

async function writeAll(entries: OutboxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* a full disk must not throw into the caller's capture flow */
  }
}

export async function enqueue(payload: Record<string, unknown>): Promise<void> {
  const entries = await readAll();
  entries.push({ key: newKey(), payload, attempts: 0, queuedAt: Date.now() });
  await writeAll(entries);
}

export async function pending(): Promise<OutboxEntry[]> {
  return readAll();
}

export interface DrainResult {
  sent: number;
  dropped: number;
  remaining: number;
}

/**
 * Tries to send everything, oldest first.
 *
 * Stops at the first transport failure. There is no point hammering four more
 * uploads at a server that has just refused to answer, and every one of those
 * attempts costs an entry an attempt it cannot spare.
 */
export async function drain(
  send: (entry: OutboxEntry) => Promise<unknown>
): Promise<DrainResult> {
  const entries = await readAll();
  if (entries.length === 0) return { sent: 0, dropped: 0, remaining: 0 };

  const keep: OutboxEntry[] = [];
  let sent = 0;
  let dropped = 0;
  let halted = false;

  for (const entry of entries) {
    if (halted) { keep.push(entry); continue; }

    try {
      await send(entry);
      sent += 1;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;

      if (status && PERMANENT.has(status)) {
        // The server has told us these bytes are wrong. Keeping them would
        // mean retrying the same rejection until the attempt cap, for nothing.
        dropped += 1;
        continue;
      }

      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        dropped += 1;
        continue;
      }

      keep.push({ ...entry, attempts });
      // A dead network stops the pass; a server error does not, because the
      // next entry may well be one it accepts.
      if (isNetworkFailure(err)) halted = true;
    }
  }

  await writeAll(keep);
  return { sent, dropped, remaining: keep.length };
}

/** Dropped on sign-out, like the queue cache: it holds this shift's media. */
export async function clearOutbox(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* nothing depends on it succeeding */
  }
}
