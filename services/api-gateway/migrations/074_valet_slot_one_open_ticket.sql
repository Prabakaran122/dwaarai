-- One car per slot, enforced by the database.
--
-- POST /guard/tickets/:token/complete stored whatever slotId the app sent,
-- without checking it belonged to this property or was free, so two
-- attendants finishing intakes at once could both be told bay B2-14 was theirs
-- -- and the second car's guest would later be sent to a bay holding a
-- stranger's car. The routes now check under a lock on the slot row; this is
-- what holds when that check is bypassed or raced by a second instance, in the
-- same way idx_valet_card_one_open_ticket backs the card check.
--
-- The status list MUST match HOLDING_A_SLOT in valet-service's guard.js
-- exactly. 'with_guest' is absent on purpose: the car is not on the lot, and
-- another car may stand in its bay meanwhile (see 070).
--
-- If existing rows already double-book a slot the index cannot be built. We
-- fail loudly rather than "fix" them: which of two tickets is really standing
-- in the bay is a question for somebody on the floor, and silently clearing
-- one ticket's slot would send its guest's valet to the wrong place. Resolve
-- with the query in the error message and re-run.
--
-- No BEGIN/COMMIT: the migration runner wraps each file in its own transaction.

DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(slot_id::text || ' (' || n || ' tickets)', ', ')
    INTO dupes
    FROM (
      SELECT slot_id, COUNT(*) AS n
        FROM valet_tickets
       WHERE slot_id IS NOT NULL
         AND status IN ('parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again')
       GROUP BY slot_id
      HAVING COUNT(*) > 1
    ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'valet slots are double-booked by open tickets: %. Find them with: SELECT id, display_id, status, slot_id FROM valet_tickets WHERE slot_id IN (...) AND status IN (''parked'',''retrieval_requested'',''en_route'',''arrived'',''parked_again''); clear slot_id on the ticket(s) not actually in the bay, then re-run the migration.', dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_slot_one_open_ticket
  ON valet_tickets (slot_id)
  WHERE slot_id IS NOT NULL
    AND status IN ('parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again');
