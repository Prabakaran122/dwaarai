import cron from 'node-cron';
import { query, queryRows } from '../db/queries.js';
import { publishNotice } from '../routes/notices.js';

/**
 * Release scheduled announcements when their time arrives (F-24).
 *
 * Clearing scheduled_at is what makes a notice visible, so it is done BEFORE
 * the notification and in a single statement that also acts as the claim: a
 * row is only picked up while scheduled_at is still set, so two overlapping
 * runs cannot both notify for the same announcement.
 */
const SCHEDULE = '* * * * *';

export async function releaseDueNotices() {
  const due = await queryRows(
    `UPDATE notices
        SET scheduled_at = NULL, last_activity_at = NOW()
      WHERE scheduled_at IS NOT NULL AND scheduled_at <= NOW() AND is_removed = false
      RETURNING *`
  );
  if (!due.length) return 0;

  for (const notice of due) {
    try {
      await query(
        `UPDATE notices SET is_pinned = false
          WHERE community_id = $1 AND category = 'official' AND is_pinned = true
            AND id NOT IN (
              SELECT id FROM notices
               WHERE community_id = $1 AND category = 'official' AND is_pinned = true
               ORDER BY created_at DESC LIMIT 3)`,
        [notice.community_id]
      );
      await publishNotice(notice);
    } catch (e) {
      // Already released and visible; only the notification was lost.
      console.error(`[Cron] notice ${notice.id} released but delivery failed:`, e.message);
    }
  }

  console.log(`[Cron] Released ${due.length} scheduled announcement(s)`);
  return due.length;
}

export function startNoticePublishCron() {
  cron.schedule(SCHEDULE, () => {
    releaseDueNotices().catch((e) => console.error('[Cron] releaseDueNotices failed:', e.message));
  });
  console.log(`[Cron] Scheduled-announcement release running (${SCHEDULE})`);
}
