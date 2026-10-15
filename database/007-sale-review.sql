-- Review belongs exclusively to Administration. The source is never changed.
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS review_status text;
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 1;
ALTER TABLE administracion.movements ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- Historical unlinked sales require review too; existing payouts remain untouched.
UPDATE administracion.movements SET review_status=CASE WHEN source_id IS NULL THEN 'pending' ELSE 'validated' END
WHERE kind='entrada' AND review_status IS NULL;
-- Legacy copies and maintenance inserts inherit the conservative state as well.
CREATE OR REPLACE FUNCTION administracion.default_sale_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='entrada' AND NEW.review_status IS NULL THEN
    NEW.review_status:=CASE WHEN NEW.source_id IS NULL THEN 'pending' ELSE 'validated' END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admin_default_sale_review ON administracion.movements;
CREATE TRIGGER admin_default_sale_review BEFORE INSERT ON administracion.movements
FOR EACH ROW EXECUTE FUNCTION administracion.default_sale_review();
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admin_sale_review' AND conrelid='administracion.movements'::regclass) THEN
    ALTER TABLE administracion.movements ADD CONSTRAINT admin_sale_review CHECK(
      (kind='salida' AND review_status IS NULL AND reviewed_at IS NULL) OR
      (kind='entrada' AND ((source_id IS NULL AND review_status IN ('pending','approved')) OR
      (source_id IS NOT NULL AND review_status='validated')) AND review_status IS NOT NULL));
    ALTER TABLE administracion.movements ADD CONSTRAINT admin_sale_review_version CHECK(review_version>=1);
  END IF;
END $$;
-- An alias retains a former manual identity after reconciliation, including voided records.
CREATE TABLE IF NOT EXISTS administracion.sale_identity_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movement_id uuid NOT NULL REFERENCES administracion.movements(id),
  folio text NOT NULL CHECK(length(btrim(folio)) BETWEEN 1 AND 160),
  origin text NOT NULL CHECK(origin IN ('negra','blanca','manual')),
  ticket_code text CHECK(ticket_code ~ '^LLA1:[VP]:[A-Za-z0-9_-]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_sale_alias_identity ON administracion.sale_identity_aliases
  (movement_id,lower(btrim(folio)),origin,COALESCE(ticket_code,''));
CREATE INDEX IF NOT EXISTS admin_sale_alias_folio ON administracion.sale_identity_aliases(lower(btrim(folio)),origin);
CREATE INDEX IF NOT EXISTS admin_sale_alias_code ON administracion.sale_identity_aliases(ticket_code) WHERE ticket_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_sale_review_pending ON administracion.movements(review_status) WHERE kind='entrada' AND voided_at IS NULL;
DROP VIEW administracion.manual_ledger;
CREATE VIEW administracion.manual_ledger AS
SELECT m.*,
  COALESCE((SELECT sum(p.amount_cents) FROM administracion.payments p WHERE p.movement_id=m.id),0)::bigint AS paid_cents,
  false AS source_cancelled,
  c.id AS commission_id,c.employee_id,e.name AS employee_name,c.amount_cents AS commission_cents,c.paid_on AS commission_paid_on
FROM administracion.movements m
LEFT JOIN administracion.commissions c ON c.movement_id=m.id
LEFT JOIN administracion.employees e ON e.id=c.employee_id;
