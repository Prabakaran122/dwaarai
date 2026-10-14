-- The commercial layer: a group's car quota, and what a promotion costs.
--
-- Held back until now on purpose, and the reason is worth keeping: the numbers
-- below are a rate card, and a rate card written into a migration is a pricing
-- decision made by whoever happened to be editing SQL. So nothing here is
-- hardcoded. Every rate is a column on the account with a default, which means
-- Dwaar AI ops can set a venue's terms without a release, and a group on a
-- negotiated contract is representable rather than a special case.
--
-- Money is integer paise throughout. Floats do not survive a ledger.

BEGIN;

-- --------------------------------------------------------------------------
-- Quota: how many cars a month a group's properties may take.
-- --------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quota_mode VARCHAR(16) NOT NULL DEFAULT 'shared';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_quota_mode_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_quota_mode_check
  CHECK (quota_mode IN ('shared', 'fixed'));

-- Cars a month included per LIVE property. A property still being set up is
-- not billed for and does not add to the pool -- otherwise a group that signs
-- four hotels and opens one is paying for three empty porches.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quota_cars_per_property INT NOT NULL DEFAULT 2000;

-- "Alert me when the group has used 80% of its cars." Stored as a percent
-- because that is how it is chosen and how it is read back.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quota_alert_percent INT NOT NULL DEFAULT 80;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_quota_alert_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_quota_alert_check
  CHECK (quota_alert_percent BETWEEN 1 AND 100);

-- What happens when the pool runs out. 'bill' keeps the valet desk running and
-- charges for the overage; 'notify' keeps it running and only tells somebody.
--
-- There is deliberately no 'stop' option. A quota is a billing arrangement,
-- and a billing arrangement must never be able to refuse a guest standing at a
-- porch with their keys out. If a group genuinely wants a hard stop that is a
-- conversation, not a dropdown.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quota_over_behaviour VARCHAR(16) NOT NULL DEFAULT 'bill';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_quota_over_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_quota_over_check
  CHECK (quota_over_behaviour IN ('bill', 'notify'));

-- Per extra car beyond the pool. Null means "not agreed" -- which is the
-- honest default, and the screen says so rather than inventing a number.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quota_overage_paise INT;

-- Cars this property keeps out of the shared pool, for example ahead of a
-- wedding weekend. Per property, so it hangs off the community.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS valet_quota_hold_back INT NOT NULL DEFAULT 0;
ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_hold_back_check;
ALTER TABLE communities ADD CONSTRAINT communities_hold_back_check
  CHECK (valet_quota_hold_back >= 0);

-- --------------------------------------------------------------------------
-- Advertising: what a promotion costs, and what has been paid toward it.
-- --------------------------------------------------------------------------

-- Per verified view -- one guest, one car, counted once per valet ticket. That
-- unit is the whole reason the events table has a unique index on
-- (promotion, ticket, kind): it is the only number that could be charged for
-- honestly, and billing is now the thing that depends on it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ad_price_per_view_paise INT NOT NULL DEFAULT 150;

-- Charged per active promotion per month, whatever it delivers.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ad_monthly_minimum_paise INT NOT NULL DEFAULT 200000;

-- GST, as a percent, because it is a tax rate that changes by law and not by
-- code. 18% today.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gst_percent INT NOT NULL DEFAULT 18;

-- An Enterprise group is invoiced monthly and never tops up; everyone else
-- spends from a balance. Which one is a contract term, so it lives here.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ad_billing VARCHAR(16) NOT NULL DEFAULT 'prepaid';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_ad_billing_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_ad_billing_check
  CHECK (ad_billing IN ('prepaid', 'invoiced'));

-- A cap, not a charge: the promotion pauses when it reaches this, and the
-- venue pays only for views delivered.
ALTER TABLE valet_promotions ADD COLUMN IF NOT EXISTS spend_limit_paise INT;

-- The hours of the day a banner shows. Null means all day, which is what
-- almost every promotion wants -- the pair exists for a breakfast buffet that
-- should not be advertised at midnight.
ALTER TABLE valet_promotions ADD COLUMN IF NOT EXISTS show_from TIME;
ALTER TABLE valet_promotions ADD COLUMN IF NOT EXISTS show_to   TIME;

-- Dwaar AI checks a promotion before it reaches a guest's screen. 'in_review'
-- sits between draft and live: the venue has finished writing, nobody outside
-- has seen it, and it cannot be edited into something else after approval
-- without going round again.
ALTER TABLE valet_promotions DROP CONSTRAINT IF EXISTS valet_promotions_status_check;
ALTER TABLE valet_promotions ADD CONSTRAINT valet_promotions_status_check
  CHECK (status IN ('draft', 'in_review', 'live', 'paused', 'ended'));

-- --------------------------------------------------------------------------
-- The ad ledger. Every paisa in and out, append-only.
-- --------------------------------------------------------------------------
--
-- A running balance column would be a number somebody has to keep correct
-- under concurrency; a ledger is the balance, summed. It is also the only
-- shape that can answer "why am I being charged this", which is the question
-- every advertising invoice eventually gets.
CREATE TABLE IF NOT EXISTS valet_ad_ledger (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scoped to the account where there is one, and to the property otherwise:
  -- a single hotel with no group still buys promotions. Exactly one is set.
  account_id    UUID REFERENCES accounts(id) ON DELETE CASCADE,
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,

  -- Positive puts money in (a top-up, or free credit); negative spends it.
  amount_paise  BIGINT NOT NULL,

  kind          VARCHAR(16) NOT NULL,

  -- Free credit is spent before paid balance, so the two are distinguishable
  -- for the life of the ledger rather than merged into one number.
  is_credit     BOOLEAN NOT NULL DEFAULT FALSE,

  promotion_id  UUID REFERENCES valet_promotions(id) ON DELETE SET NULL,
  note          VARCHAR(240),

  -- The payment this came from, when it came from one. Placeholder orders are
  -- recorded too, and read as "recorded" rather than "paid" everywhere.
  order_ref     VARCHAR(120),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valet_ad_ledger_kind_check CHECK (
    kind IN ('topup', 'credit', 'spend', 'refund', 'adjustment')
  ),
  -- Exactly one owner. A row belonging to both, or to neither, is a balance
  -- that can be counted twice or not at all.
  CONSTRAINT valet_ad_ledger_one_owner CHECK (
    (account_id IS NULL) <> (community_id IS NULL)
  ),
  -- Money in is positive, money out is negative. Enforced here because a
  -- mis-signed spend silently credits an advertiser.
  CONSTRAINT valet_ad_ledger_sign CHECK (
    (kind IN ('topup', 'credit', 'refund') AND amount_paise > 0)
    OR (kind = 'spend' AND amount_paise < 0)
    OR kind = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS idx_valet_ad_ledger_account
  ON valet_ad_ledger (account_id, created_at DESC) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_valet_ad_ledger_community
  ON valet_ad_ledger (community_id, created_at DESC) WHERE community_id IS NOT NULL;

-- One ledger row per payment, so a retried webhook or a double-tapped top-up
-- cannot credit twice. Partial, because only paid rows carry a reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_ad_ledger_order
  ON valet_ad_ledger (order_ref) WHERE order_ref IS NOT NULL;

COMMIT;
