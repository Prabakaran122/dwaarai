-- The plate photo taken at intake.
--
-- The BRD's Screen 4 opens a camera by default and treats the attendant's
-- typed plate as the real data underneath it. Until now the app had no camera
-- there at all, and the one it gained for ANPR read a frame and threw it away.
--
-- A photo that is read and discarded is worth very little; a photo that is
-- kept is evidence of what the plate actually said when the car arrived,
-- which is the half that survives a dispute and does not depend on a
-- recogniser being deployed. So it is stored -- as a condition record, not a
-- new table, because everything that makes condition media safe to hold is
-- already built around that one: the retention sweep, the dispute exemption
-- that stops a flagged ticket's media being swept, and the storage adapter
-- that puts bytes in S3 or on disk depending on the venue.
--
-- 'plate' is a fifth angle rather than a new stage. The stage says WHEN the
-- media was taken (intake vs return) and that is unchanged; the angle says
-- WHAT it shows, and "the number plate" is a different thing to see than
-- "the front of the car" -- a front three-quarter shot that proves there was
-- no bumper damage may not have a legible registration in it.
--
-- Widened rather than dropped-and-recreated: an ALTER that names the old
-- constraint leaves every existing row alone, and a deploy that half-applies
-- cannot end up with no constraint at all.

ALTER TABLE valet_condition_records
  DROP CONSTRAINT IF EXISTS valet_condition_angle_check;

ALTER TABLE valet_condition_records
  ADD CONSTRAINT valet_condition_angle_check CHECK (
    angle IS NULL OR angle IN ('front', 'back', 'left', 'right', 'plate')
  );
