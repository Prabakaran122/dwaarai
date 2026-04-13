-- 010_security_hardening.sql — Guard passwords + token blacklist

-- Add password_hash column to residents for guard authentication
ALTER TABLE residents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(200);

-- Token blacklist for logout / revocation (stored in Redis primarily, this is fallback)
CREATE TABLE IF NOT EXISTS token_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_hash ON token_blacklist(token_hash);

-- Auto-clean expired blacklist entries (run via cron or app logic)
-- DELETE FROM token_blacklist WHERE expires_at < NOW();
