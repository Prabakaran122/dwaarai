import cron from 'node-cron';
import { query, queryRows } from '../db/queries.js';

/**
 * Check if today (day of week) matches a recurring pass schedule.
 */
function matchesToday(scheduleType, scheduleDays) {
  const today = new Date().getDay();
  switch (scheduleType) {
    case 'daily':
      return true;
    case 'weekday':
      return today >= 1 && today <= 5;
    case 'weekly':
    case 'custom':
      return Array.isArray(scheduleDays) && scheduleDays.includes(today);
    default:
      return false;
  }
}

/**
 * Generate expected_visits for today from all active recurring_passes.
 * Skips passes that already have a visit generated for today.
 * Also marks yesterday's unresolved 'expected' as 'missed'.
 */
export async function generateExpectedVisits() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    // Mark yesterday's unresolved expected visits as missed
    const missed = await query(
      `UPDATE expected_visits SET status = 'missed'
       WHERE visit_date = $1 AND status = 'expected'
       RETURNING id`,
      [yesterday]
    );
    if (missed.length > 0) {
      console.log(`[Cron] Marked ${missed.length} visits as missed for ${yesterday}`);
    }

    // Get all active recurring passes
    const passes = await queryRows(
      `SELECT rp.*, u.unit_number
       FROM recurring_passes rp
       JOIN units u ON u.id = rp.unit_id
       WHERE rp.status = 'active'`
    );

    let generated = 0;

    for (const pass of passes) {
      if (!matchesToday(pass.schedule_type, pass.schedule_days)) continue;

      // Skip if already generated for today
      const existing = await query(
        `SELECT id FROM expected_visits
         WHERE recurring_pass_id = $1 AND visit_date = $2`,
        [pass.id, today]
      );
      if (existing.length > 0) continue;

      await query(
        `INSERT INTO expected_visits
           (recurring_pass_id, community_id, unit_id, visit_date,
            time_from, time_until, visitor_name_normalized, visitor_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [pass.id, pass.community_id, pass.unit_id, today,
         pass.time_from, pass.time_until, pass.visitor_name_normalized, pass.visitor_role]
      );
      generated++;
    }

    if (generated > 0) {
      console.log(`[Cron] Generated ${generated} expected visits for ${today}`);
    }
  } catch (err) {
    console.error('[Cron] Generate visits error:', err);
  }
}

/**
 * Start the daily cron job. Also runs immediately on startup.
 */
export function startVisitCron() {
  generateExpectedVisits();

  cron.schedule('5 0 * * *', () => {
    console.log('[Cron] Running daily visit generation');
    generateExpectedVisits();
  });

  console.log('[Cron] Visit generation cron scheduled (daily 00:05)');
}
