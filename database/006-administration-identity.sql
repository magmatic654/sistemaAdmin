-- This migration belongs only to the separate Administration database.
ALTER TABLE administracion.configuration ADD COLUMN IF NOT EXISTS instance_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE administracion.configuration ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'development' CHECK(environment IN ('development','production'));
