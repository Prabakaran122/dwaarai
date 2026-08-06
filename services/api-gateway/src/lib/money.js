/**
 * Money is integer paise everywhere. Floats do not survive a ledger.
 *
 * The BRD fixes the platform fee at 3% of the stall fee, "rounded to the
 * nearest rupee" — so the fee is always a whole number of rupees, and is
 * NEVER charged on a donation (taking a cut of a religious or community
 * collection is a deliberate non-goal).
 */
export const PLATFORM_FEE_RATE = 0.03;

export function platformFeePaise(stallFeePaise) {
  const rawPaise = stallFeePaise * PLATFORM_FEE_RATE;
  return Math.round(rawPaise / 100) * 100;
}

export function stallTotalPaise(stallFeePaise) {
  return stallFeePaise + platformFeePaise(stallFeePaise);
}

export function rupees(paise) {
  return (paise / 100).toFixed(2);
}
