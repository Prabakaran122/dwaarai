-- Razorpay top-ups for the valet ad balance.
--
-- In placeholder mode a top-up was credited in the same request, because a
-- placeholder order cannot fail. A real one can -- abandoned at the checkout,
-- declined by the bank -- so in live mode the request now only opens an order,
-- and this table remembers it until Razorpay says the money arrived. The
-- ledger row is written then, and only then.
--
-- The amounts are copied here at order time rather than recomputed at
-- settlement: the GST rate is an account setting, and a rate changed while a
-- venue sat at the checkout must not change what the payment they already
-- made is worth.

BEGIN;

CREATE TABLE IF NOT EXISTS valet_ad_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Razorpay's order id (order_...). The ledger row carries the same value,
  -- and its unique index is the second guard against crediting twice.
  order_ref     VARCHAR(120) NOT NULL UNIQUE,

  -- Same ownership rule as the ledger: the account where there is one, the
  -- property otherwise, exactly one of the two.
  account_id    UUID REFERENCES accounts(id) ON DELETE CASCADE,
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,

  -- What the venue is credited (net) and what Razorpay collects (total).
  net_paise     BIGINT NOT NULL CHECK (net_paise > 0),
  gst_paise     BIGINT NOT NULL CHECK (gst_paise >= 0),
  total_paise   BIGINT NOT NULL CHECK (total_paise = net_paise + gst_paise),

  status        VARCHAR(16) NOT NULL DEFAULT 'created',
  payment_ref   VARCHAR(120),

  -- The signed-in admin (JWT sub). Text, not an FK: admins and group admins
  -- live in different tables, and the record is for a support conversation.
  created_by    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ,

  CONSTRAINT valet_ad_orders_status_check CHECK (status IN ('created', 'paid')),
  CONSTRAINT valet_ad_orders_one_owner CHECK (
    (account_id IS NULL) <> (community_id IS NULL)
  )
);

COMMIT;
