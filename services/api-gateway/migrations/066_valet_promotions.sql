-- A promotion on the guest's thank-you page.
--
-- Today this is one line of text and a link, held in communities.config. The
-- redesign asks for a banner a guest actually looks at, an offer code that can
-- be traced back to the valet ticket it came from, and counts of what that
-- produced -- none of which fits in two config keys.
--
-- Deliberately NOT built here: pricing, ad balance, top-ups, GST and the
-- review queue. Those are commercial decisions, not schema, and the repo's
-- payment layer is still in placeholder mode pending an undecided open
-- question. A venue can run a promotion and measure it without any of that;
-- inventing a price per view in a migration would be the wrong place to
-- decide what to charge.

CREATE TABLE IF NOT EXISTS valet_promotions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

  headline      VARCHAR(80)  NOT NULL,
  body          VARCHAR(240),
  image_key     TEXT,

  button_label  VARCHAR(40),
  button_url    TEXT,

  -- The stem of the code a guest is shown. Their copy has the ticket's claim
  -- code appended, which is what makes every redemption traceable to one car
  -- on one night rather than to "somebody saw a poster".
  offer_code    VARCHAR(24),
  redeem_note   VARCHAR(240),

  starts_at     TIMESTAMPTZ,
  -- The banner comes down on its own after this. A promotion nobody remembers
  -- to stop is how a hotel ends up advertising last month's brunch.
  ends_at       TIMESTAMPTZ,

  status        VARCHAR(16) NOT NULL DEFAULT 'draft',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valet_promotions_status_check CHECK (
    status IN ('draft', 'live', 'paused', 'ended')
  )
);

-- At most one live promotion per property. Two banners cannot both be on the
-- same thank-you screen, and letting a second go live would silently hide the
-- first rather than refusing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_promotions_one_live
  ON valet_promotions (community_id)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_valet_promotions_community
  ON valet_promotions (community_id, created_at DESC);

-- What a promotion actually produced.
--
-- A view is recorded once per valet ticket, deliberately: the guest page polls
-- every few seconds and reloads whenever somebody reopens the link, so
-- counting raw impressions would turn one guest refreshing on a slow
-- connection into forty. "One guest, one car, one view" is the only number
-- worth putting in front of a venue, and it is the only one that could ever be
-- charged for honestly.
CREATE TABLE IF NOT EXISTS valet_promotion_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promotion_id  UUID NOT NULL REFERENCES valet_promotions(id) ON DELETE CASCADE,
  ticket_id     UUID NOT NULL REFERENCES valet_tickets(id) ON DELETE CASCADE,

  kind          VARCHAR(10) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valet_promotion_events_kind_check CHECK (kind IN ('view', 'tap', 'redeem'))
);

-- The uniqueness that makes the numbers mean something.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_promotion_events_once
  ON valet_promotion_events (promotion_id, ticket_id, kind);

CREATE INDEX IF NOT EXISTS idx_valet_promotion_events_promo
  ON valet_promotion_events (promotion_id, kind);
