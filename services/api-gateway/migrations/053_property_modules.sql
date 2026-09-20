-- Which DwaarAI products a property actually bought.
--
-- The admin portal has shown every property all fourteen nav items since it
-- was built, which was fine while every customer was a gated society running
-- the whole suite. A hotel that buys valet alone is currently looking at
-- Residents, Units, SOS Monitor and Notice Board -- none of which mean
-- anything to them, and all of which make the product look like it was sold to
-- someone else.
--
-- Lives on community_entitlements because that is already the per-property,
-- super-admin-only table, and its own header says societies cannot turn their
-- own layers on or off. Module access is commercial in exactly the same way:
-- a property must not be able to grant itself a product.
--
-- Defaults to all three. Every existing property keeps precisely what it has
-- today, and only a property explicitly narrowed sees a narrower portal --
-- so this cannot quietly take a screen away from anyone.
ALTER TABLE community_entitlements
  ADD COLUMN IF NOT EXISTS modules TEXT[] NOT NULL DEFAULT ARRAY['gate', 'community', 'valet'];

-- A property with no entitlements row at all must not vanish from its own
-- portal, so absence is read as "everything" in the API rather than "nothing".
COMMENT ON COLUMN community_entitlements.modules IS
  'Products this property bought: gate (Nazar), community (Basera), valet. Absent row means all.';
