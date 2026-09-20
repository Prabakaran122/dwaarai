/**
 * Which car to fetch next.
 *
 * Strict first-in-first-out is the obvious rule and the wrong one: it sends an
 * attendant standing on B1 down to B3 and back while a car two bays away waits
 * for a guest who asked later. Pure nearest-first is worse — it strands
 * whoever parked furthest away for as long as the stand is busy.
 *
 * So: waiting time is the signal, distance is a discount on it.
 *
 * ---------------------------------------------------------------------------
 * THESE WEIGHTS ARE A STARTING POINT, NOT A MEASUREMENT.
 *
 * Nobody has timed a walk from B1-A to B3-C in a real garage. They are set so
 * that roughly a minute of waiting is worth one "floor" of walking, which is
 * a guess that feels right at a small property and probably is not at a large
 * one. Retune them here, against real trip times, and nothing else has to
 * change: this function is the whole policy.
 * ---------------------------------------------------------------------------
 */

export interface SlotRef {
  floor: string;
  zone: string;
}

export interface RetrievalJob {
  waitedMinutes: number;
  slot: SlotRef | null;
}

/** A minute of a guest waiting, in the same units as a floor of walking. */
const WAIT_WEIGHT = 1;

/** What one level of stairs or ramp costs, in guest-minutes. */
const FLOOR_COST = 1.5;

/** What crossing to another zone on the same level costs. */
const ZONE_COST = 0.5;

/**
 * A car with no slot recorded. Slots are optional — a full garage means cars
 * in aisles — and such a car must still be fetched, so it is treated as an
 * average walk rather than dropped or pushed to the end.
 */
const UNKNOWN_SLOT_COST = 1;

/** Basement levels read B1..B3 downward; ground is 0; upper floors count up. */
function levelOf(floor: string): number {
  const f = floor.toUpperCase();
  const basement = f.match(/^B(\d+)$/);
  if (basement) return -Number(basement[1]);
  if (f === 'G' || f === 'GF') return 0;
  const n = Number(f);
  return Number.isFinite(n) ? n : 0;
}

function walkCost(from: SlotRef | null, to: SlotRef | null): number {
  // No idea where the attendant is, or where the car is: distance cannot
  // discount anything, so the ranking falls back to pure waiting time.
  if (!from || !to) return to === null ? UNKNOWN_SLOT_COST : 0;

  const floors = Math.abs(levelOf(from.floor) - levelOf(to.floor));
  const zones = from.zone.toUpperCase() === to.zone.toUpperCase() ? 0 : 1;
  return floors * FLOOR_COST + zones * ZONE_COST;
}

/** Higher is more urgent. */
export function scoreRetrieval(job: RetrievalJob, attendantAt: SlotRef | null): number {
  return job.waitedMinutes * WAIT_WEIGHT - walkCost(attendantAt, job.slot);
}

export function rankRetrievals<T extends RetrievalJob>(
  jobs: T[], attendantAt: SlotRef | null
): T[] {
  return [...jobs].sort((a, b) => scoreRetrieval(b, attendantAt) - scoreRetrieval(a, attendantAt));
}
