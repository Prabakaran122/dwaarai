-- New vehicle entry intake (BRD Nazar §5.3, NAZ-019..029) reuses
-- approval_requests (guard -> resident approval) rather than a new table,
-- since it is the same underlying flow with extra vehicle metadata attached.

ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(20);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS purpose VARCHAR(30);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS photo_s3_key TEXT;
