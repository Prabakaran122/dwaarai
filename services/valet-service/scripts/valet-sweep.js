#!/usr/bin/env node
/**
 * Retention and expiry sweep, as a one-shot process.
 *
 * The prototype ran this on a setInterval inside the request-serving process,
 * which its own README flagged as a production gap: it duplicates across
 * instances and dies with the web process. Run this from cron or an ECS
 * scheduled task instead.
 *
 *   node scripts/valet-sweep.js
 */
import { runSweep } from '../src/lib/expiry.js';
import pool from '../src/db.js';

try {
  const result = await runSweep();
  console.log(
    `valet sweep: expired ${result.tickets} ticket(s), deleted ${result.photos} photo(s), ${result.condition} condition record(s)`
  );
  await pool.end();
} catch (err) {
  console.error('valet sweep failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
}
