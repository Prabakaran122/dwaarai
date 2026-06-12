-- 024_delivery_photo.sql — optional guard photo on a parcel
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS image_path VARCHAR(255);
