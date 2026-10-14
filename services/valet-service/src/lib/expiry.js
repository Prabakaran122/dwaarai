import { query, queryRows } from '../db.js';
import { sweepIdempotencyKeys } from './idempotency.js';
import { logEvent } from './events.js';
import { storage } from './storage.js';

// with_guest included: a guest who drove off for good must not hold the card
// (and the ticket) open past the end of their stay.
const OPEN_STATUSES = ['parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again', 'with_guest'];

function retentionInterval() {
  const hours = Number(process.env.PHOTO_RETENTION_HOURS || 24);
  return `${hours} hours`;
}

/**
 * Closes any ticket past its stay-end, whether or not the guest ever came
 * back for a final pickup.
 *
 * Note there is no string-format hazard here, unlike the SQLite original:
 * `stay_end_at` is TIMESTAMPTZ and NOW() is a real timestamp, so this is an
 * actual temporal comparison rather than a lexicographic one between two
 * differently formatted strings.
 */
export async function sweepExpiredTickets() {
  const overdue = await queryRows(
    `UPDATE valet_tickets
        SET status = 'expired', closed_at = NOW()
      WHERE status = ANY($1) AND stay_end_at < NOW()
      RETURNING id`,
    [OPEN_STATUSES]
  );

  for (const { id } of overdue) {
    await logEvent(id, 'expired', { metadata: { reason: 'stay_end_at passed without final checkout' } });
    await schedulePhotoDeletion(id);
    await scheduleConditionMediaDeletion(id);
  }
  return overdue.length;
}

/** Stamps the retention window on a closed ticket's guest photo. */
export async function schedulePhotoDeletion(ticketId, client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE valet_photos
        SET auto_delete_after = NOW() + $2::interval
      WHERE ticket_id = $1 AND auto_delete_after IS NULL`,
    [ticketId, retentionInterval()]
  );
}

/**
 * Same retention window as the guest photo, for both stages of condition media.
 *
 * Deliberately does NOT consult the disputed flag: a dispute can be raised at
 * any point before actual deletion, including after this has run, so that
 * check belongs at delete time (see sweepExpiredConditionMedia) and would be
 * wrong here.
 */
export async function scheduleConditionMediaDeletion(ticketId, client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE valet_condition_records
        SET auto_delete_after = NOW() + $2::interval
      WHERE ticket_id = $1 AND auto_delete_after IS NULL`,
    [ticketId, retentionInterval()]
  );
}

/** Removes guest photo bytes once their retention window has passed. */
export async function sweepExpiredPhotos() {
  const due = await queryRows(
    `UPDATE valet_photos
        SET deleted_at = NOW()
      WHERE auto_delete_after IS NOT NULL
        AND auto_delete_after < NOW()
        AND deleted_at IS NULL
      RETURNING id, storage_key`
  );

  for (const row of due) {
    await storage.delete(row.storage_key);
  }
  return due.length;
}

/**
 * Same as sweepExpiredPhotos, except a ticket flagged disputed is skipped
 * entirely regardless of what auto_delete_after says.
 *
 * This is the real retention exception the dispute feature exists for, and it
 * is checked here — at deletion time — so flagging a dispute after the window
 * was already scheduled still protects the media.
 */
export async function sweepExpiredConditionMedia() {
  const due = await queryRows(
    `UPDATE valet_condition_records vcr
        SET deleted_at = NOW()
       FROM valet_tickets t
      WHERE t.id = vcr.ticket_id
        AND vcr.auto_delete_after IS NOT NULL
        AND vcr.auto_delete_after < NOW()
        AND vcr.deleted_at IS NULL
        AND t.disputed = FALSE
      RETURNING vcr.id, vcr.storage_key`
  );

  for (const row of due) {
    await storage.delete(row.storage_key);
  }
  return due.length;
}

/**
 * Drops the guest phone number from every closed ticket.
 *
 * The number is collected for one purpose -- delivering one claim code for one
 * stay -- and that purpose is spent the moment the car leaves. Keeping it
 * would quietly turn a delivery mechanism into a customer list nobody
 * consented to, which is the distinction the separate DPDP timestamps exist to
 * preserve. The discount opt-in keeps its number because it has to honour a
 * code later; this one has no such reason.
 *
 * Done in the sweep rather than at each closing point so there is one place it
 * happens, and so a ticket closed by any path -- final pickup, expiry, or a
 * route added later -- is covered without anyone remembering to.
 */
export async function forgetClosedGuestPhones() {
  const cleared = await queryRows(
    `UPDATE valet_tickets
        SET phone_number = NULL, phone_consent_at = NULL
      WHERE phone_number IS NOT NULL
        AND status IN ('final_closed', 'expired')
      RETURNING id`
  );
  return cleared.length;
}

/** How long a car may stand at the pickup point before it is flagged. */
function collectionWindow() {
  const minutes = Number(process.env.COLLECTION_WINDOW_MINUTES || 5);
  return `${minutes} minutes`;
}

/**
 * Cars still standing at the pickup point past the collection window.
 *
 * The guest page shows a countdown, but that is a comfort and nothing more:
 * it runs only while somebody has the page open, and the car blocking a hotel
 * porch does not care whether anyone is watching a timer. This is the
 * enforcement -- measured from the arrival event, on a schedule, whether or
 * not a client exists.
 *
 * It flags rather than re-parks. Moving the ticket back to 'parked' would say
 * the car is in a bay when it is demonstrably at the door, and a record that
 * lies is worse than one that is merely late. The event is what the queue and
 * the duty manager act on.
 */
export async function sweepOverdueCollections() {
  const overdue = await queryRows(
    `SELECT t.id
       FROM valet_tickets t
       JOIN valet_ticket_events a
         ON a.ticket_id = t.id AND a.event_type = 'arrived'
      WHERE t.status = 'arrived'
        AND a.created_at < NOW() - ($1)::interval
        AND NOT EXISTS (
          SELECT 1 FROM valet_ticket_events o
           WHERE o.ticket_id = t.id
             AND o.event_type = 'collection_overdue'
             AND o.created_at > a.created_at
        )
      GROUP BY t.id`,
    [collectionWindow()]
  );

  for (const { id } of overdue) {
    await logEvent(id, 'collection_overdue', {
      metadata: { window: collectionWindow() },
    });
  }
  return overdue.length;
}

/**
 * How long a guest waits before nobody having come is worth telling someone.
 */
function responseWindow() {
  const minutes = Number(process.env.RESPONSE_WINDOW_MINUTES || 4);
  return `${minutes} minutes`;
}

/**
 * Requests no attendant ever accepted.
 *
 * The mirror of sweepOverdueCollections: that one catches a guest who never
 * came for an arrived car, this one catches a car nobody set off to fetch.
 *
 * It exists because the failing part can be the device. A guest's request
 * travels from their phone to this server and never touches the attendant's
 * handset -- the app learns about it by polling. An app in a basement polls
 * nothing, so the request lands perfectly, the guest is told "a valet will
 * pick this up shortly", and no one is walking anywhere. That is worse than a
 * request that failed outright, because the guest has been given a promise.
 *
 * Deliberately server-side and deliberately blind to the reason. Offline, flat
 * battery, app closed, attendant already carrying keys for another car -- all
 * the same from here, and anything that relied on the silent device noticing
 * its own silence would not be a safety net.
 *
 * Flags rather than reassigns. Who picks the car up is a floor decision; this
 * only makes sure a human is told there is one to make.
 */
export async function sweepUnacceptedRequests() {
  const stale = await queryRows(
    `SELECT t.id
       FROM valet_tickets t
       JOIN valet_ticket_events r
         ON r.ticket_id = t.id AND r.event_type = 'requested'
      WHERE t.status = 'retrieval_requested'
        AND r.created_at < NOW() - ($1)::interval
        -- Nobody took it. An accept after the request is the thing that makes
        -- this fine, so it has to be compared against that request, not any
        -- earlier one on a multi-day ticket.
        AND NOT EXISTS (
          SELECT 1 FROM valet_ticket_events a
           WHERE a.ticket_id = t.id
             AND a.event_type = 'accepted'
             AND a.created_at > r.created_at
        )
        -- And it has not already been raised for this request. The sweep runs
        -- repeatedly; without this a duty manager gets a fresh alert every
        -- pass for a car somebody is already walking to.
        AND NOT EXISTS (
          SELECT 1 FROM valet_ticket_events u
           WHERE u.ticket_id = t.id
             AND u.event_type = 'request_unanswered'
             AND u.created_at > r.created_at
        )
      GROUP BY t.id`,
    [responseWindow()]
  );

  for (const { id } of stale ?? []) {
    await logEvent(id, 'request_unanswered', {
      metadata: { window: responseWindow() },
    });
  }
  return (stale ?? []).length;
}

export async function runSweep() {
  const tickets = await sweepExpiredTickets();
  const photos = await sweepExpiredPhotos();
  const condition = await sweepExpiredConditionMedia();
  const phones = await forgetClosedGuestPhones();
  const overdue = await sweepOverdueCollections();
  const unanswered = await sweepUnacceptedRequests();
  const idempotency = await sweepIdempotencyKeys().catch(() => 0);
  return { tickets, photos, condition, phones, overdue, unanswered, idempotency };
}

/**
 * In-process timer, used only when VALET_RUN_SWEEP_IN_PROCESS is set.
 *
 * The default is off: with more than one service instance running, every
 * instance would sweep, and deletion work belongs on a schedule outside the
 * request-serving process. `scripts/valet-sweep.js` is the entrypoint for a
 * cron/ECS scheduled task.
 */
export function startExpirySweep() {
  const minutes = Number(process.env.EXPIRY_SWEEP_MINUTES || 5);
  const run = () => {
    runSweep().catch((err) => console.error('valet sweep failed:', err));
  };
  run();
  return setInterval(run, minutes * 60 * 1000);
}
