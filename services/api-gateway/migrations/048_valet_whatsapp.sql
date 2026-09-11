-- WhatsApp as the default way into a valet ticket.
--
-- Two things the flow cannot work without, and nothing more.

-- When the guest last messaged us. WhatsApp allows free-form replies only
-- within 24 hours of a user-initiated message; outside that window only an
-- approved template is delivered -- and a free-form send outside it is
-- accepted by the API and silently dropped, which would mean a guest on a
-- multi-day stay never hearing that their car is ready. Every outbound
-- decision reads this column, so it is stamped on every inbound.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS whatsapp_last_inbound_at TIMESTAMPTZ;

-- Inbound de-duplication.
--
-- Providers retry a webhook they believe failed. Without this, a retried
-- "bring my car" is acted on twice and a second valet is sent for a car
-- already on its way. The UNIQUE constraint is the whole mechanism: the row is
-- written before the message is acted on, so a redelivery finds it and stops.
CREATE TABLE IF NOT EXISTS valet_whatsapp_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_message_id VARCHAR(128) NOT NULL UNIQUE,
  ticket_id           UUID REFERENCES valet_tickets(id),
  direction           VARCHAR(8)   NOT NULL CHECK (direction IN ('in', 'out')),
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valet_whatsapp_ticket
  ON valet_whatsapp_messages(ticket_id);
