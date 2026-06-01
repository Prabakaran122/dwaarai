-- 017_guard_language.sql
-- Guard App 3.9 (Multilingual): persist each guard's preferred UI language.
-- Guards are residents with type='guard', so the column lives on residents.
-- Society-level default language uses communities.config (JSONB) — no schema change.

ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en';
