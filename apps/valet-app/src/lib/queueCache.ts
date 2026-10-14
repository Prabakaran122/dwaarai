import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ValetTicket } from '../api/valet';

/**
 * The last queue the server gave us.
 *
 * Kept so a dropped connection shows an attendant the cars that were on the
 * lot a few minutes ago rather than an empty screen. Stale and labelled as
 * stale beats blank: an empty list reads as "nothing is parked", which on a
 * busy evening is a lie somebody would act on.
 *
 * Written on every successful poll, which is often -- but it is one small JSON
 * blob and the alternative, writing only on change, means diffing a list on
 * every poll to save a write that AsyncStorage already batches.
 */

const KEY = 'dwaar_valet_queue_cache';

export interface CachedQueue {
  tickets: ValetTicket[];
  /** When the server handed us this, not when it was written. */
  savedAt: number;
}

export async function saveQueue(tickets: ValetTicket[]): Promise<void> {
  try {
    const payload: CachedQueue = { tickets, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Caching is a convenience, never a precondition. A full disk must not be
    // able to stop a valet taking a car in.
  }
}

export async function loadQueue(): Promise<CachedQueue | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQueue;
    // A half-written or hand-edited blob is the same as none. Returning
    // something shaped wrong would crash the screen it exists to protect.
    if (!parsed || !Array.isArray(parsed.tickets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Dropped on sign-out. The queue carries plates and guest names, and a stand
 * phone passes between attendants at every shift change.
 */
export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* nothing useful to do, and nothing depends on it succeeding */
  }
}
