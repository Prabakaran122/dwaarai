import { ratePerHour } from './rhythm.js';
import { buildEvent } from './event.js';
import { GATES } from './config.js';

function pickGate(rand) {
  let roll = rand();
  for (const gate of GATES) {
    roll -= gate.share;
    if (roll <= 0) return gate;
  }
  return GATES[GATES.length - 1];
}

/**
 * Walks backwards `days` days hour by hour, emitting the number of events that
 * hour's rate calls for. Uses a per-hour count rather than the live generator's
 * Poisson gaps because the backfill only needs the right shape, not the right
 * arrival process — and a count is far cheaper for 11k rows.
 */
export function buildHistory({ pop, days, until, rand }) {
  const events = [];
  const start = new Date(until.getTime() - days * 24 * 3600 * 1000);

  for (let cursor = new Date(start); cursor <= until; cursor = new Date(cursor.getTime() + 3600 * 1000)) {
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const rate = ratePerHour(cursor.getUTCHours(), isWeekend);
    // Vary each hour by ±25% so no two days are identical.
    const count = Math.max(0, Math.round(rate * (0.75 + rand() * 0.5)));

    for (let i = 0; i < count; i++) {
      const at = new Date(cursor.getTime() + Math.floor(rand() * 3600 * 1000));
      if (at > until) continue;
      events.push(buildEvent({ pop, gate: pickGate(rand), at, rand }));
    }
  }

  events.sort((a, b) => a.event_ts.localeCompare(b.event_ts));
  return events;
}
