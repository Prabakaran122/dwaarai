-- Widen gate_events.detection_method for biometric verify methods.
--
-- The original VARCHAR(10) fit 'anpr' / 'rfid' / 'fastag' / 'manual', but the
-- SpeedFace-V5L terminal reports how a PERSON was identified: 'fingerprint'
-- and 'finger_vein' are 11 chars and would fail the insert. The matching
-- zod limits live in api-gateway/src/routes/gates.js and
-- gate-command-service/src/routes.js.
--
-- ALTER TYPE on a partitioned table cascades to every partition automatically.
ALTER TABLE gate_events ALTER COLUMN detection_method TYPE VARCHAR(20);
