-- Why a card is out of use, and since when.
--
-- "Retire" was a yes/no on is_active, so the cards page could only say a code
-- was gone -- not whether it was lost (it may turn up; a stranger may scan it)
-- or damaged (it will not), nor since when. The page now shows "Lost · 20 Oct"
-- and offers "Found it -- put back in use", which needs both.
--
-- Nullable: cards retired before this migration have neither, and the page
-- says only "Out of use" for them. Putting a card back in use clears both.
ALTER TABLE valet_cards
  ADD COLUMN IF NOT EXISTS retired_reason TEXT
    CHECK (retired_reason IS NULL OR retired_reason IN ('lost', 'damaged')),
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
