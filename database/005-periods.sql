ALTER TABLE administracion.commission_payouts DROP CONSTRAINT IF EXISTS commission_payouts_period_check;
ALTER TABLE administracion.commission_payouts ADD CONSTRAINT commission_payouts_period_check CHECK(period IN ('day','week','month','custom','all'));
