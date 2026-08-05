-- 038_poll_vote_rules.sql — make polls.one_vote_per_unit actually enforceable
--
-- HUMAN RULING: migration 029 created an UNCONDITIONAL unique index
-- (uniq_poll_unit ON poll_votes(poll_id, unit_id) — see 029_committee_polls.sql).
-- That makes the one_vote_per_unit toggle added on `polls` in 037 a lie: it
-- could never be switched off, because the database refused a second vote
-- from the same unit no matter what the poll said.
--
-- Fix: copy the flag onto poll_votes itself (set from the parent poll at
-- insert time going forward — see routes/polls.js), backfill it for existing
-- rows, drop the unconditional index, and replace it with a PARTIAL unique
-- index that only applies WHERE one_vote_per_unit. Polls that want the rule
-- keep a database backstop; polls that switch it off genuinely allow several
-- residents of the same flat to vote.
--
-- Idempotent: IF NOT EXISTS / IF EXISTS throughout, so a second application
-- (or applying to a database baselined past this point) is a no-op.

ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS one_vote_per_unit BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill from the parent poll. Every row that predates this migration was
-- inserted while 029's unconditional index was in force, so every one of
-- them in fact obeyed one-vote-per-unit regardless of what the poll's own
-- (037-added) flag says today — but we copy the poll's current value, not a
-- hardcoded TRUE, so a poll that already had the flag flipped off before this
-- migration ran keeps that intent. IS DISTINCT FROM avoids rewriting rows
-- that already match on a second run.
UPDATE poll_votes v
   SET one_vote_per_unit = p.one_vote_per_unit
  FROM polls p
 WHERE v.poll_id = p.id
   AND v.one_vote_per_unit IS DISTINCT FROM p.one_vote_per_unit;

-- Drop the unconditional index from 029. Exact name verified in
-- 029_committee_polls.sql: `CREATE UNIQUE INDEX IF NOT EXISTS uniq_poll_unit
-- ON poll_votes(poll_id, unit_id);`
DROP INDEX IF EXISTS uniq_poll_unit;

-- Replacement: unique only among rows that opted into the rule. This is a
-- strict subset of what the old unconditional index covered (every existing
-- row's one_vote_per_unit was just backfilled to TRUE-or-whatever-the-poll-
-- says, and the old index already guaranteed no (poll_id, unit_id) duplicates
-- existed at all), so creating this index cannot fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_poll_unit_when_required
  ON poll_votes(poll_id, unit_id)
  WHERE one_vote_per_unit;
