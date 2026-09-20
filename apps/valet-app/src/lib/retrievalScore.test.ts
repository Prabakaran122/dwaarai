import { scoreRetrieval, rankRetrievals } from './retrievalScore';

const job = (over: Partial<Parameters<typeof scoreRetrieval>[0]> = {}) => ({
  waitedMinutes: 0,
  slot: { floor: 'B1', zone: 'A' },
  ...over,
} as Parameters<typeof scoreRetrieval>[0]);

describe('ranking cars to fetch', () => {
  it('puts a longer wait ahead of a shorter one, all else equal', () => {
    const near = scoreRetrieval(job({ waitedMinutes: 2 }), { floor: 'B1', zone: 'A' });
    const far = scoreRetrieval(job({ waitedMinutes: 9 }), { floor: 'B1', zone: 'A' });

    expect(far).toBeGreaterThan(near);
  });

  it('prefers the nearer car when two guests have waited the same', () => {
    const sameZone = scoreRetrieval(job({ waitedMinutes: 5 }), { floor: 'B1', zone: 'A' });
    const otherFloor = scoreRetrieval(
      job({ waitedMinutes: 5, slot: { floor: 'B3', zone: 'C' } }), { floor: 'B1', zone: 'A' }
    );

    // Two identical waits, and one of them is two levels down.
    expect(sameZone).toBeGreaterThan(otherFloor);
  });

  it('lets a long wait outrank a short walk — a guest is standing in a lobby', () => {
    const nearButFresh = scoreRetrieval(job({ waitedMinutes: 1 }), { floor: 'B1', zone: 'A' });
    const farButWaiting = scoreRetrieval(
      job({ waitedMinutes: 20, slot: { floor: 'B3', zone: 'C' } }), { floor: 'B1', zone: 'A' }
    );

    expect(farButWaiting).toBeGreaterThan(nearButFresh);
  });

  it('scores a car with no slot on wait alone, rather than dropping it', () => {
    // Slots are optional; a car parked in an aisle still has to be fetched.
    expect(scoreRetrieval(job({ waitedMinutes: 5, slot: null }), { floor: 'B1', zone: 'A' }))
      .toBeGreaterThan(0);
  });

  it('falls back to wait order when the attendant has no last slot', () => {
    const a = scoreRetrieval(job({ waitedMinutes: 3 }), null);
    const b = scoreRetrieval(job({ waitedMinutes: 8 }), null);

    expect(b).toBeGreaterThan(a);
  });

  it('ranks a queue, longest-waiting-nearest first', () => {
    const ranked = rankRetrievals([
      { id: 'far-fresh', waitedMinutes: 1, slot: { floor: 'B3', zone: 'C' } },
      { id: 'near-old', waitedMinutes: 12, slot: { floor: 'B1', zone: 'A' } },
      { id: 'near-fresh', waitedMinutes: 2, slot: { floor: 'B1', zone: 'A' } },
    ], { floor: 'B1', zone: 'A' });

    expect(ranked[0].id).toBe('near-old');
  });
});
