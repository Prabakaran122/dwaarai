-- The role most valet staff actually hold.
--
-- 057 offered 'valet_manager' and 'temporary_driver', which between them
-- describe the exceptions rather than the rule: a property with eight
-- attendants and one supervisor had to call all eight managers, or mark
-- permanent staff temporary. The staff screen's own design lists "Valet"
-- first, and it was the one value the enum did not have.
--
-- Added rather than replacing anything: every existing row stays valid, and
-- the default for a new staff member stays 'valet_manager' until the portal
-- starts offering a choice, so this migration changes no behaviour on its own.

ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_valet_role_check;
ALTER TABLE residents ADD CONSTRAINT residents_valet_role_check
  CHECK (valet_role IS NULL OR valet_role IN ('valet', 'valet_manager', 'temporary_driver'));
