import { queryOne } from '../db.js';

/**
 * When the car most recently reached the guest.
 *
 * Every "since this arrival" rule in the valet flow hangs off this event
 * rather than off the ticket row, because a multi-day ticket arrives more than
 * once: the same ticket is handed over on Friday, parked again, and handed
 * over on Sunday. Scoping to the ticket alone would let Friday's scan and
 * Friday's return photos satisfy Sunday's handover.
 */
export function lastArrivalAt(ticketId) {
  return queryOne(
    `SELECT created_at FROM valet_ticket_events
      WHERE ticket_id = $1 AND event_type = 'arrived'
      ORDER BY created_at DESC LIMIT 1`,
    [ticketId]
  );
}

/**
 * A rotating token issued since `since` that the guard actually scanned.
 *
 * The QR keeps rotating for freshness even after a successful scan, so this
 * deliberately does not require the *latest* token to be the used one — the
 * guest's next auto-refresh would otherwise invalidate a scan that happened
 * a second ago.
 */
export function usedTokenSince(ticketId, since) {
  return queryOne(
    `SELECT id FROM valet_rotating_tokens
      WHERE ticket_id = $1 AND used_at IS NOT NULL AND generated_at >= $2 LIMIT 1`,
    [ticketId, since]
  );
}

/**
 * Whether the guest has taken the car for this arrival.
 *
 * This is the guest-facing half of the handover: the scan is the moment the
 * car becomes theirs. Confirming pickup comes later — the guard still has to
 * photograph the car — and by then the guest has driven off, which is why
 * nothing the guest needs to see can wait for it.
 */
export async function handedOver(ticket, knownArrival = undefined) {
  if (ticket.status !== 'arrived') return false;
  // The caller often needs the arrival itself — for the collection countdown —
  // and looking it up twice per poll, every four seconds, per guest, is a
  // query nobody should be paying for.
  const arrival = knownArrival !== undefined ? knownArrival : await lastArrivalAt(ticket.id);
  if (!arrival) return false;
  return !!(await usedTokenSince(ticket.id, arrival.created_at));
}
