import type { QueueEntry } from '../store/queueStore';

export type FaceStatus = 'idle' | 'checking' | 'confirmed' | 'flagged' | 'unavailable';
export type OverallResult = 'green' | 'amber' | 'red';

interface Entitlements {
  fastag: boolean;
  anpr: boolean;
  face: boolean;
  aiAnomaly: boolean;
}

interface ComputeInput {
  entry: QueueEntry;
  faceStatus?: FaceStatus;
  entitlements: Entitlements;
}

interface ComputeOutput {
  result: OverallResult;
  anomaly: string | null;
}

// BRD §5.2 (NAZ-014, NAZ-018) — the verification screen's overall result card
// and soft anomaly alert. A hard block (blacklist, FASTag mismatch, a flagged
// face) is red; an active layer that simply hasn't produced a result yet (an
// unrecognized plate awaiting review, or a face scan the guard hasn't taken)
// is amber, not a false "all clear"; only when every entitled layer that has
// run agrees is it green.
export function computeOverallResult({ entry, faceStatus, entitlements }: ComputeInput): ComputeOutput {
  const fastagMismatch = entry.alertType === 'fastag_mismatch';
  const faceFlagged = entitlements.face && faceStatus === 'flagged';

  if (entry.decision === 'deny' || fastagMismatch || faceFlagged) {
    let anomaly: string | null = null;
    if (entitlements.aiAnomaly) {
      if (fastagMismatch) anomaly = 'FASTag mismatch — different tag for known vehicle';
      else if (faceFlagged) anomaly = 'Driver face does not match the vehicle owner';
    }
    return { result: 'red', anomaly };
  }

  const unresolvedReview = entry.decision === 'guard_review';
  const faceStillPending = entitlements.face && (!faceStatus || faceStatus === 'idle' || faceStatus === 'checking');
  const faceUnavailable = entitlements.face && faceStatus === 'unavailable';

  if (unresolvedReview || faceStillPending || faceUnavailable) {
    return { result: 'amber', anomaly: null };
  }

  return { result: 'green', anomaly: null };
}
