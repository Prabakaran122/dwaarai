/**
 * Traffic shape for the demo society.
 *
 * Rates are community-wide (all three gates combined) and sum to ~1,150 events
 * on a weekday, matching the seeded history so today's bar doesn't tower over
 * the previous ten days.
 *
 * Gaps come from an exponential distribution — a Poisson process — because that
 * is what clusters events into natural bursts and lulls. A uniform random delay
 * produces an even drip that reads as synthetic to anyone who knows the domain.
 */

// index = hour of day, value = events/hour community-wide
const WEEKDAY = [
  8,  4,  3,  3,  3,  6,   // 00-05 near-dead
  20, 45, 130, 130, 70, 55, // 06-11 staff arrivals, office + school rush
  50, 45, 40, 40, 45, 70,  // 12-17 deliveries, school return
  110, 110, 90, 45, 25, 12, // 18-23 evening return peak, tapering
];

// Weekends: no commute spikes, more midday visitors, later nights.
const WEEKEND = [
  14, 8,  5,  3,  3,  5,
  12, 22, 40, 55, 70, 80,
  80, 75, 65, 60, 60, 70,
  85, 85, 75, 55, 35, 20,
];

export function ratePerHour(hour, isWeekend) {
  const table = isWeekend ? WEEKEND : WEEKDAY;
  return table[((hour % 24) + 24) % 24];
}

/**
 * Asia/Kolkata is UTC+05:30 all year — India has never observed daylight saving —
 * so a fixed offset is exact and, unlike Intl.DateTimeFormat, carries no runtime
 * dependency on a full-ICU Node build.
 */
export const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/**
 * Hour-of-day and day-of-week in Asia/Kolkata.
 *
 * The curve above is a *local* daily rhythm and the dashboard buckets every
 * hourly and daily chart in Asia/Kolkata (routes/dashboard.js DEFAULT_TZ), so
 * every caller that maps an instant onto the curve must agree on the zone.
 * Both callers (history.js backfill, generate.js live loop) go through this one
 * function precisely so they cannot drift apart again: reading the hour off a
 * UTC server shifts the whole society by 5½ hours and nothing errors.
 */
export function istClock(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const day = shifted.getUTCDay();
  return { hour: shifted.getUTCHours(), day, isWeekend: day === 0 || day === 6 };
}

/**
 * Exponential inter-arrival gap for a Poisson process of `rate` events/hour.
 * Clamped below at 1s so a burst can't spin the loop.
 */
export function nextGapMs(rate, rand) {
  const safeRate = Math.max(rate, 0.5);
  const u = Math.max(rand(), 1e-9); // avoid log(0)
  const hours = -Math.log(u) / safeRate;
  return Math.max(1000, Math.round(hours * 3600 * 1000));
}

/** Small seeded PRNG so a re-run reproduces the same society. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
