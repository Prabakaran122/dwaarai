/**
 * The four condition views, in the order they are captured -- at intake, at
 * every handover, and when a car comes back from a guest.
 *
 * One list on purpose. Intake and return each had their own, in different
 * orders, and return accepted a single photo: a dispute then compared four
 * "before" views with as few as one "after". The photos are only evidence if
 * the same four views exist on both sides, taken the same way round.
 */
export const CONDITION_ANGLES = ['front', 'right', 'back', 'left'] as const;

export type ConditionAngle = (typeof CONDITION_ANGLES)[number];

/** The next angle to capture, or null once the set is complete. */
export function nextAngle(captured: readonly string[]): ConditionAngle | null {
  return CONDITION_ANGLES.find((a) => !captured.includes(a)) ?? null;
}
