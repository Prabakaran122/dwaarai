-- 015_dues.sql
-- Feature 5 (Resident App brief): Maintenance Dues + payments.
-- Treasurer (admin portal) sets the amounts; the resident app reads what's owed,
-- pays via Razorpay, and gets a receipt. Phase 1: no partial payments.

CREATE TABLE IF NOT EXISTS dues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  unit_id        UUID NOT NULL REFERENCES units(id),
  period         VARCHAR(20) NOT NULL,                 -- e.g. '2026-05' or 'Q2 2026'
  description    VARCHAR(200),
  base_amount    NUMERIC(12,2) NOT NULL,
  penalty_amount NUMERIC(12,2) NOT NULL DEFAULT 0,     -- shown broken out from base
  due_date       DATE,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'paid'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dues_unit_status
  ON dues(community_id, unit_id, status);

CREATE TABLE IF NOT EXISTS due_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  due_id             UUID NOT NULL REFERENCES dues(id),
  community_id       UUID NOT NULL REFERENCES communities(id),
  unit_id            UUID NOT NULL REFERENCES units(id),
  resident_id        UUID REFERENCES residents(id),
  amount             NUMERIC(12,2) NOT NULL,
  gateway            VARCHAR(20) NOT NULL DEFAULT 'razorpay',  -- 'razorpay' | 'manual'
  gateway_order_id   VARCHAR(100),
  gateway_payment_id VARCHAR(100),
  receipt_no         VARCHAR(40),
  status             VARCHAR(20) NOT NULL DEFAULT 'created',   -- 'created' | 'paid' | 'failed'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_due_payments_order ON due_payments(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_due_payments_unit  ON due_payments(community_id, unit_id, status);
