import cron from 'node-cron';
import { query, queryRows } from '../db/queries.js';
import { sendToMultiple } from '../lib/fcm.js';

/**
 * Auto-close polls past their closing time and push a result summary (F-19).
 *
 * Read paths already treat a past closes_at as closed, so voting is refused on
 * time whether or not this runs. What the cron adds is the authoritative state
 * flip and the notification — which means a failure here degrades the feature
 * rather than breaking it, and the summary push is deliberately wrapped so a
 * dead FCM never leaves a poll stuck open.
 */

// Every five minutes. The BRD wants voting to stop "at the exact close time",
// which the read-path check already guarantees; this only bounds how late the
// notification can be.
const SCHEDULE = '*/5 * * * *';

export function summaryText(question, options) {
  const total = options.reduce((n, o) => n + Number(o.votes || 0), 0);
  if (!total) return `${question} — closed with no votes.`;
  const top = options.reduce((a, b) => (Number(b.votes || 0) > Number(a.votes || 0) ? b : a));
  const pct = Math.round((Number(top.votes || 0) / total) * 100);
  return `${question} — "${top.label}" led with ${pct}% of ${total} votes.`;
}

export async function closeDuePolls() {
  const due = await queryRows(
    `SELECT id, question, community_id
       FROM polls
      WHERE closes_at IS NOT NULL AND closes_at < NOW() AND status <> 'closed'`
  );
  if (!due.length) return 0;

  for (const poll of due) {
    // Flip first. If the notification below throws, the poll is still closed
    // and the next run will not pick it up again — no duplicate summaries.
    await query(`UPDATE polls SET status = 'closed' WHERE id = $1`, [poll.id]);

    try {
      const options = await queryRows(
        `SELECT po.label, COUNT(pv.id) AS votes
           FROM poll_options po
           LEFT JOIN poll_votes pv ON pv.option_id = po.id
          WHERE po.poll_id = $1
          GROUP BY po.id, po.label`,
        [poll.id]
      );
      const recipients = await queryRows(
        `SELECT fcm_token FROM residents
          WHERE community_id = $1 AND is_active = true AND fcm_token IS NOT NULL`,
        [poll.community_id]
      );
      const tokens = recipients.map((r) => r.fcm_token).filter(Boolean);
      if (tokens.length) {
        await sendToMultiple(tokens, 'Poll closed', summaryText(poll.question, options), {
          type: 'poll_closed',
          poll_id: poll.id,
        });
      }
    } catch (e) {
      console.error(`[Cron] poll ${poll.id} closed but summary push failed:`, e.message);
    }
  }

  console.log(`[Cron] Closed ${due.length} due poll(s)`);
  return due.length;
}

export function startPollCloseCron() {
  cron.schedule(SCHEDULE, () => {
    closeDuePolls().catch((e) => console.error('[Cron] closeDuePolls failed:', e.message));
  });
  console.log(`[Cron] Poll auto-close scheduled (${SCHEDULE})`);
}
