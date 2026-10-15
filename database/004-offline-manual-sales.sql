-- Manual fallback sales never require a record in the other applications.
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS manual_folio text;
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS manual_origin text CHECK(manual_origin IN ('negra','blanca','manual'));
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS manual_ticket_code text CHECK(manual_ticket_code ~ '^LLA1:[VP]:[A-Za-z0-9_-]{1,80}$');
ALTER TABLE administracion.movements DROP CONSTRAINT IF EXISTS admin_income_requires_ticket;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admin_income_identity' AND conrelid='administracion.movements'::regclass) THEN
    ALTER TABLE administracion.movements ADD CONSTRAINT admin_income_identity
      CHECK(kind<>'entrada' OR source_id IS NOT NULL OR
        (length(btrim(manual_folio)) BETWEEN 1 AND 160 AND manual_origin IS NOT NULL AND manual_folio IS NOT NULL));
    ALTER TABLE administracion.movements ADD CONSTRAINT admin_manual_identity
      CHECK((manual_folio IS NULL AND manual_origin IS NULL AND manual_ticket_code IS NULL) OR
        (kind='entrada' AND source_id IS NULL AND manual_folio IS NOT NULL AND manual_origin IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_folio ON administracion.movements(manual_origin,lower(btrim(manual_folio))) WHERE manual_folio IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_ticket_code ON administracion.movements(manual_ticket_code) WHERE manual_ticket_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_source_folio ON administracion.movements(lower(btrim(source_folio)),source_origin) WHERE source_folio IS NOT NULL;
DROP VIEW administracion.manual_ledger;
CREATE VIEW administracion.manual_ledger AS
SELECT m.*,
  COALESCE((SELECT sum(p.amount_cents) FROM administracion.payments p WHERE p.movement_id=m.id),0)::bigint AS paid_cents,
  false AS source_cancelled,
  c.id AS commission_id,c.employee_id,e.name AS employee_name,c.amount_cents AS commission_cents,c.paid_on AS commission_paid_on
FROM administracion.movements m
LEFT JOIN administracion.commissions c ON c.movement_id=m.id
LEFT JOIN administracion.employees e ON e.id=c.employee_id;
