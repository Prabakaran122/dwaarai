-- What the BRD's Job record carries that ours did not.
--
-- Guest name, car type and a premium flag. All three exist because the admin
-- portal's reporting is meant to answer questions our vehicle log currently
-- cannot: how many SUVs came through, how many premium cars, and whose car
-- was it -- a plate is an identifier, not a person.

-- Nullable, and it stays nullable. A guest who declines to give a name still
-- gets their car parked, and an intake that insists would be an intake guards
-- learn to type "x" into.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120);

-- Hatchback / Sedan / SUV in the BRD. Constrained rather than free text
-- because the whole point is counting them, and free text cannot be counted.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS car_type VARCHAR(20);

ALTER TABLE valet_tickets
  DROP CONSTRAINT IF EXISTS valet_tickets_car_type_check;
ALTER TABLE valet_tickets
  ADD CONSTRAINT valet_tickets_car_type_check
  CHECK (car_type IS NULL OR car_type IN ('hatchback', 'sedan', 'suv'));

-- Flags the cars a venue treats differently -- closer parking, a senior
-- attendant. Not a price tier: nothing here charges anyone.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
