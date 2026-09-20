-- Interest, captured where it is expressed.
--
-- One table for two flows, because they are the same shape and splitting them
-- would mean two screens to check instead of one:
--
--   advertising  — a venue without the promo slot asking to be given it
--   cross_sell   — a venue asking about another DwaarAI product
--
-- Logging is deliberately the entire feature. Nothing is emailed and nobody is
-- notified; a lead nobody reads is still better than a demand signal thrown
-- away, and wiring a notification before anyone has read one is guesswork.

CREATE TABLE IF NOT EXISTS valet_leads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id),

  source        VARCHAR(20) NOT NULL CHECK (source IN ('advertising', 'cross_sell')),
  -- Which product, for a cross-sell. Null for an advertising request.
  product       VARCHAR(60),

  contact_name  VARCHAR(120),
  contact_phone VARCHAR(20),
  contact_email VARCHAR(160),
  message       TEXT,

  -- Who asked, so a follow-up call can name them.
  raised_by     UUID REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valet_leads_community
  ON valet_leads(community_id, created_at DESC);
