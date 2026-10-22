import * as api from '../api/valet';
import { enqueue, drain, type OutboxEntry, type DrainResult } from './outbox';
import { isNetworkFailure, reachability } from './connectivity';

type Stage = 'intake' | 'return';
type MediaType = 'photo' | 'video';
type Angle = 'front' | 'back' | 'left' | 'right' | 'plate';

export interface CaptureResult {
  /** Whether the attendant's capture is safe -- uploaded or durably queued. */
  ok: boolean;
  /** Whether it is waiting rather than already on the server. */
  queued: boolean;
}

/**
 * Upload a condition capture, or keep it until the server is reachable.
 *
 * Condition media is evidence, and the places it is captured -- a basement
 * bay, a ramp, the far end of a lot -- are the places with no signal. Losing a
 * photo there is the exact failure this exists to stop.
 *
 * A queued capture is reported as SUCCESS, deliberately. The attendant did
 * take the photo; telling them it failed sends them to retake it, which queues
 * a second copy of the same angle and teaches them the camera is unreliable.
 * What they need to know about the queue belongs in one banner, not in four
 * per-capture errors.
 */
export async function uploadOrQueue(
  sessionToken: string,
  uri: string,
  stage: Stage,
  mediaType: MediaType,
  angle?: Angle
): Promise<CaptureResult> {
  try {
    await api.uploadCondition(sessionToken, uri, stage, mediaType, angle);
    return { ok: true, queued: false };
  } catch (err) {
    // Only a transport failure is worth keeping. A server that actively
    // refused these bytes will refuse them again, and queueing would retry the
    // same rejection to the attempt cap while telling the attendant it was
    // safely captured.
    if (!isNetworkFailure(err)) return { ok: false, queued: false };

    // Tells the banner, and arms the reconnect edge the app-level sync waits
    // on. Only the queue's poll used to report this, so on any other screen
    // nothing ever noticed the server had come back.
    reachability.getState().noteFailure(err);

    // Tagged with the venue, so a phone later signed into a different property
    // keeps these for their own venue rather than 404ing them away.
    const durable = await enqueue({
      kind: 'condition', sessionToken, uri, stage, mediaType, angle,
      community: api.currentCommunityId?.() ?? null,
    });
    // Not written means not safe. Saying "captured" for a photo that exists
    // nowhere is the one outcome worse than asking for a retake.
    return durable ? { ok: true, queued: true } : { ok: false, queued: false };
  }
}

/**
 * Sends whatever is waiting. Called on reconnect.
 *
 * The key travels with the request so the server can dedupe it: a reply lost
 * on a flaky reconnect replays without the photo being stored twice.
 */
let inFlight: Promise<DrainResult> | null = null;

export function flushConditionQueue(): Promise<DrainResult> {
  // One drain at a time. The sync now fires from a timer, a reconnect and a
  // sign-in, and two overlapping passes would upload the same photo twice and
  // each charge it an attempt.
  if (inFlight) return inFlight;

  const here = api.currentCommunityId?.() ?? null;
  inFlight = drain(
    (entry: OutboxEntry) => {
      const p = entry.payload as {
        sessionToken: string; uri: string; stage: Stage;
        mediaType: MediaType; angle?: Angle;
      };
      return api.uploadCondition(
        p.sessionToken, p.uri, p.stage, p.mediaType, p.angle, entry.key
      );
    },
    // Another venue's photos wait for a session of their own venue. Untagged
    // entries (queued before 0.9) and an unreadable token both fall through
    // to being sent, which is what happened before.
    (entry) => {
      const owner = (entry.payload as { community?: string | null }).community;
      return !!owner && !!here && owner !== here;
    }
  ).finally(() => { inFlight = null; });
  return inFlight;
}
