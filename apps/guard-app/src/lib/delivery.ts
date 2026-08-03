// NAZ-045: a delivery waiting at the gate more than 15 minutes gets a red
// border + alert chip in the Parcels tab.
const OVERSTAY_THRESHOLD_MS = 15 * 60_000;

export function isOverstayed(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() >= OVERSTAY_THRESHOLD_MS;
}
