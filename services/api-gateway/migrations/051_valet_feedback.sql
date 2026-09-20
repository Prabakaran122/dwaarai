-- One tap of sentiment, at the end of a trip.
--
-- Its own table rather than columns on valet_tickets, for the same reason the
-- discount opt-in has one: it is written by the guest long after the guard has
-- finished with the row, it has its own timestamp, and a ticket that never
-- gets feedback should not carry three null columns forever.

CREATE TABLE IF NOT EXISTS valet_feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- One per trip. The UNIQUE is the enforcement, not a check in the route:
  -- a guest who taps twice on a flaky connection must not double-count, and
  -- a rollup built on double-counted sentiment is worse than no rollup.
  ticket_id   UUID NOT NULL UNIQUE REFERENCES valet_tickets(id),
  community_id UUID NOT NULL REFERENCES communities(id),

  satisfied   BOOLEAN NOT NULL,

  -- Only meaningful when satisfied is false. Free text is deliberately not
  -- collected: a chip can be counted, and a rollup is the entire point of
  -- asking. Anything a guest needs to say at length belongs to the venue, not
  -- to a sentiment widget.
  reasons     TEXT[] NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valet_feedback_community
  ON valet_feedback(community_id, created_at DESC);
