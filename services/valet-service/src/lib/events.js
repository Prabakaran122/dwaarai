import { query } from '../db.js';

/**
 * Appends one row to a ticket's audit trail.
 *
 * `valet_ticket_events` is the record of what happened; `valet_tickets.status`
 * is only the current position in the flow. Every transition writes here.
 *
 * Accepts an optional `client` so a caller inside a transaction logs on the
 * same connection and the event rolls back with the change it describes.
 */
export async function logEvent(ticketId, eventType, { guardId = null, metadata = null, client = null } = {}) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO valet_ticket_events (ticket_id, event_type, guard_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, eventType, guardId, metadata ? JSON.stringify(metadata) : null]
  );
}
