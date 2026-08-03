-- NAZ-030..043: walk-in visitor intake reuses approval_requests, adding the
-- visitor's contact + ID details needed before a resident can approve entry.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS visitor_mobile TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS id_type TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS id_photo_s3_key TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS face_photo_s3_key TEXT;
