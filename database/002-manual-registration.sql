-- Every income is explicitly captured against one canonical printed ticket.
-- No feeds, automatic imports, source totals or source cancellations drive the dashboard.
DROP VIEW IF EXISTS administracion.ledger;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admin_income_requires_ticket' AND conrelid='administracion.movements'::regclass) THEN
    ALTER TABLE administracion.movements ADD CONSTRAINT admin_income_requires_ticket
      CHECK(kind<>'entrada' OR (source_kind IS NOT NULL AND source_id IS NOT NULL));
  END IF;
END $$;
CREATE OR REPLACE VIEW administracion.manual_ledger AS
SELECT m.*,
  COALESCE((SELECT sum(p.amount_cents) FROM administracion.payments p WHERE p.movement_id=m.id),0)::bigint AS paid_cents,
  false AS source_cancelled,
  c.id AS commission_id,c.employee_id,e.name AS employee_name,c.amount_cents AS commission_cents,c.paid_on AS commission_paid_on
FROM administracion.movements m
LEFT JOIN administracion.commissions c ON c.movement_id=m.id
LEFT JOIN administracion.employees e ON e.id=c.employee_id;
