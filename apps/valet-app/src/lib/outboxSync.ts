import { subscribeToReconnect } from './onReconnect';
import { flushConditionQueue } from './conditionQueue';

/**
 * Sends queued condition photos from wherever the attendant happens to be.
 *
 * This used to live in the queue screen's effect, so the outbox drained only
 * while the queue was on screen. An attendant who photographed a car in the
 * basement and then stayed on intake or handover -- the screens where photos
 * are actually taken -- carried them around unsent until they happened to go
 * back to the list.
 *
 * Started by the app root whenever a session exists, which also covers the
 * other half of not clearing the outbox on sign-out: the next sign-in sends
 * what the last shift left behind.
 *
 * Three triggers, because each misses something the others catch:
 *   - immediately, for whatever an earlier session left;
 *   - on the offline -> online edge, the moment the server answers again;
 *   - a slow timer, because that edge is only seen when something notices
 *     the outage, and a photo queued on a server 5xx never trips it.
 * The timer is cheap: an empty outbox is one storage read and no request.
 */
export const OUTBOX_SYNC_MS = 30000;

export function startOutboxSync(): () => void {
  const flush = () => { void flushConditionQueue().catch(() => undefined); };

  flush();
  const stop = subscribeToReconnect(flush);
  const timer = setInterval(flush, OUTBOX_SYNC_MS);

  return () => { stop(); clearInterval(timer); };
}
