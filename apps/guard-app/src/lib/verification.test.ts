import { computeOverallResult, type FaceStatus } from './verification';
import type { QueueEntry } from '../store/queueStore';

const baseEntry: QueueEntry = {
  id: 'e1',
  plate: 'KA01AB1234',
  method: 'fastag',
  decision: 'allow',
  timestamp: new Date().toISOString(),
  unitNumber: 'A-204',
  residentName: 'Asha Rao',
};

const allOn = { fastag: true, anpr: true, face: true, aiAnomaly: true };

describe('computeOverallResult (NAZ-014, NAZ-018)', () => {
  it('is green when every active layer passes', () => {
    const r = computeOverallResult({ entry: baseEntry, faceStatus: 'confirmed', entitlements: allOn });
    expect(r.result).toBe('green');
    expect(r.anomaly).toBeNull();
  });

  it('is red for a blacklisted (deny) entry', () => {
    const r = computeOverallResult({ entry: { ...baseEntry, decision: 'deny', reason: 'stolen' }, entitlements: allOn });
    expect(r.result).toBe('red');
  });

  it('is red on a FASTag mismatch, with an anomaly message when AI layer is on', () => {
    const r = computeOverallResult({ entry: { ...baseEntry, alertType: 'fastag_mismatch' }, entitlements: allOn });
    expect(r.result).toBe('red');
    expect(r.anomaly).toMatch(/FASTag mismatch/i);
  });

  it('suppresses the anomaly message when the AI layer is not entitled', () => {
    const r = computeOverallResult({
      entry: { ...baseEntry, alertType: 'fastag_mismatch' },
      entitlements: { ...allOn, aiAnomaly: false },
    });
    expect(r.result).toBe('red');
    expect(r.anomaly).toBeNull();
  });

  it('is red when the face layer is flagged', () => {
    const r = computeOverallResult({ entry: baseEntry, faceStatus: 'flagged' as FaceStatus, entitlements: allOn });
    expect(r.result).toBe('red');
    expect(r.anomaly).toMatch(/face/i);
  });

  it('is amber for an unrecognized vehicle awaiting guard review', () => {
    const r = computeOverallResult({ entry: { ...baseEntry, decision: 'guard_review', residentName: undefined, unitNumber: undefined }, entitlements: allOn });
    expect(r.result).toBe('amber');
  });

  it('is amber when the entitled face layer has not produced a result yet', () => {
    const r = computeOverallResult({ entry: baseEntry, faceStatus: 'idle', entitlements: allOn });
    expect(r.result).toBe('amber');
  });

  it('does not require a face result when the face layer is not entitled', () => {
    const r = computeOverallResult({ entry: baseEntry, faceStatus: 'idle', entitlements: { ...allOn, face: false } });
    expect(r.result).toBe('green');
  });
});
