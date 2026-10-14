-- What a hotel wants to tell us.
--
-- Every other screen in this product carries information one way: we show a
-- venue what their valet desk did. This is the only one that runs the other
-- way, and the redesign is explicit about why -- "the founding team reads
-- every note, and many hotel requests become features". A venue that can see
-- its own suggestion move from Planned to Live is a venue that keeps sending
-- them.
--
-- Deliberately not the guest feedback table. That one is a tally of
-- satisfied/not with fixed reason chips, designed to be counted. This is prose
-- from a named person at a property, designed to be read once and answered.
-- Merging them would make both worse.

CREATE TABLE IF NOT EXISTS valet_ideas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

  -- Who sent it, so we can go back to them. Nullable because an admin may be
  -- removed later and the idea is still worth keeping.
  submitted_by  UUID REFERENCES admins(id) ON DELETE SET NULL,

  -- The four the redesign offers. They are not severity: "a problem unique to
  -- our hotel" and "an idea for something new" need different people to read
  -- them, which is the whole reason for asking.
  category      VARCHAR(24) NOT NULL,
  title         VARCHAR(160) NOT NULL,
  body          TEXT NOT NULL,

  -- How much it costs them today. Their words for it, not a priority we set.
  impact        VARCHAR(16),

  -- "Our team can call me to understand this better". A venue that ticks this
  -- is offering their time, and not calling them back is worse than not asking.
  callback      BOOLEAN NOT NULL DEFAULT false,

  -- Where it stands, and the one line we say about it. Both are ours to write,
  -- which is why they default to the honest "nobody has looked yet".
  status        VARCHAR(24) NOT NULL DEFAULT 'received',
  latest_update TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Checked here rather than in the route: a status the UI cannot render is a
  -- row that silently disappears from a venue's list, and they would have no
  -- way to know their note had been dropped.
  CONSTRAINT valet_ideas_category_check CHECK (category IN (
    'not_working', 'make_better', 'our_hotel', 'something_new'
  )),
  CONSTRAINT valet_ideas_status_check CHECK (status IN (
    'received', 'looking_into_it', 'planned', 'being_built', 'live', 'not_planned'
  )),
  CONSTRAINT valet_ideas_impact_check CHECK (
    impact IS NULL OR impact IN ('a_little', 'daily', 'a_lot')
  )
);

-- A venue's own list, newest first. The only read path there is.
CREATE INDEX IF NOT EXISTS idx_valet_ideas_community
  ON valet_ideas (community_id, created_at DESC);
