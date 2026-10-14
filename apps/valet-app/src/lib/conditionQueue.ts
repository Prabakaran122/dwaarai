import * as api from '../api/valet';
import { enqueue, drain, type OutboxEntry, type DrainResult } from './outbox';
import { isNetworkFailure } from './connectivity';

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

    await enqueue({ kind: 'condition', sessionToken, uri, stage, mediaType, angle });
    return { ok: true, queued: true };
  }
}

/**
 * Sends whatever is waiting. Called on reconnect.
 *
 * The key travels with the request so the server can dedupe it: a reply lost
 * on a flaky reconnect replays without the photo being stored twice.
 */
export function flushConditionQueue(): Promise<DrainResult> {
  return drain((entry: OutboxEntry) => {
    const p = entry.payload as {
      sessionToken: string; uri: string; stage: Stage;
      mediaType: MediaType; angle?: Angle;
    };
    return api.uploadCondition(
      p.sessionToken, p.uri, p.stage, p.mediaType, p.angle, entry.key
    );
  });
}
