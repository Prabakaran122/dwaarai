-- NAZ-059/060: incident photo + voice-recording attachments.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS photo_s3_key TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS audio_s3_key TEXT;
