-- A screenshot attached to an idea.
--
-- "A screen that behaves oddly" is far easier to show than to describe, and
-- the form explicitly invites people to write in Hindi or Kannada — a picture
-- is often the clearest thing they can send us. Added separately from 064
-- rather than folded into it: that migration has already run in production,
-- and editing an applied migration is how a schema quietly diverges between
-- the box and a fresh checkout.

ALTER TABLE valet_ideas ADD COLUMN IF NOT EXISTS image_key TEXT;
