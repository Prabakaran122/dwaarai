-- Making a retried write safe to send twice.
--
-- The valet app is about to start queueing operations it could not send, and
-- a queue without this is worse than no queue: an intake whose reply is lost
-- on a flaky reconnect gets replayed, and the car is taken in twice under two
-- display ids, with one card bound to a ticket nobody is looking at.
--
-- The client sends a UUID it generated for the operation. The first request
-- carrying a given key does the work and stores what it answered; every later
-- request carrying the same key gets that same answer back without the work
-- running again.
--
-- Scoped by community as well as key. The key comes from a client and a
-- client is not a trust boundary -- without the scope, a key guessed or
-- replayed from one venue could read back another venue's response body.
--
-- `response_body` is nullable and `completed_at` is the marker: a row with
-- neither means "another request holding this key is in flight right now",
-- which is what lets two concurrent retries be told apart from a replay of a
-- finished one. Claiming the row before doing the work is the whole trick --
-- INSERT ... ON CONFLICT DO NOTHING is atomic, so exactly one caller wins.

CREATE TABLE IF NOT EXISTS valet_idempotency_keys (
  key             VARCHAR(64)  NOT NULL,
  community_id    UUID         NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

  -- What was called. A key replayed against a different route is a client
  -- bug, and returning the first route's body would be a silent, baffling
  -- wrong answer rather than a loud one.
  route           VARCHAR(120) NOT NULL,

  response_status INT,
  response_body   JSONB,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- NULL while the first request is still running.
  completed_at    TIMESTAMPTZ,

  PRIMARY KEY (community_id, key)
);

-- The sweep deletes by age; without this it scans the whole table every hour.
CREATE INDEX IF NOT EXISTS idx_valet_idempotency_created
  ON valet_idempotency_keys (created_at);
