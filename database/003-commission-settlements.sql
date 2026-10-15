-- Administration-only preferences and immutable commission settlements.
CREATE TABLE IF NOT EXISTS administracion.preferences (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  commission_rate_bps integer CHECK(commission_rate_bps BETWEEN 1 AND 10000)
);
INSERT INTO administracion.preferences(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS administracion.commission_payouts (
  id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES administracion.employees(id),
  period text NOT NULL CHECK(period IN ('day','week','month')),
  date_from date NOT NULL, date_to date NOT NULL CHECK(date_to>=date_from),
  paid_on date NOT NULL CHECK(paid_on BETWEEN '2000-01-01' AND '2100-12-31'),
  amount_cents bigint NOT NULL CHECK(amount_cents>0),
  commission_count integer NOT NULL CHECK(commission_count>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE administracion.commissions ADD COLUMN IF NOT EXISTS rate_bps integer CHECK(rate_bps BETWEEN 1 AND 10000);
ALTER TABLE administracion.commissions ADD COLUMN IF NOT EXISTS mode text CHECK(mode IN ('fixed','percent'));
ALTER TABLE administracion.commissions ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES administracion.commission_payouts(id);
CREATE INDEX IF NOT EXISTS admin_pending_employee_commission ON administracion.commissions(employee_id) WHERE paid_on IS NULL;
CREATE OR REPLACE FUNCTION administracion.protect_paid_commission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.paid_on IS NOT NULL THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'A paid commission cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'A paid commission cannot be changed or paid twice' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_paid_commission ON administracion.commissions;
CREATE TRIGGER protect_paid_commission BEFORE UPDATE OR DELETE ON administracion.commissions
FOR EACH ROW EXECUTE FUNCTION administracion.protect_paid_commission();
