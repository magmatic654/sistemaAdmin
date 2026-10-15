-- Additive migration. No changes to public sales, stock, archives or counters.
CREATE SCHEMA IF NOT EXISTS administracion;
CREATE TABLE IF NOT EXISTS administracion.configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version integer NOT NULL CHECK(version=1), installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administracion.employees (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
  position text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administracion.suppliers (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
  name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED UNIQUE,
  tax_id text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
  concept text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Proveedores',
  method text NOT NULL DEFAULT 'transferencia' CHECK(method IN ('efectivo','tarjeta','transferencia','otro')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administracion.movements (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('entrada','salida')),
  date date NOT NULL CHECK(date BETWEEN '2000-01-01' AND '2100-12-31'),
  concept text NOT NULL CHECK(length(btrim(concept)) BETWEEN 1 AND 300), category text NOT NULL,
  contact text NOT NULL, phone text NOT NULL DEFAULT '', supplier_id uuid REFERENCES administracion.suppliers(id),
  items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
  subtotal_cents bigint NOT NULL CHECK(subtotal_cents>=0), tax_cents bigint NOT NULL CHECK(tax_cents>=0),
  total_cents bigint NOT NULL CHECK(total_cents BETWEEN 1 AND 99999999999),
  method text NOT NULL CHECK(method IN ('efectivo','tarjeta','transferencia','otro')),
  reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  source_kind text CHECK(source_kind IN ('ventas','ventas_productos')), source_id text,
  source_folio text, source_origin text CHECK(source_origin IN ('blanca','negra')),
  cost_cents bigint CHECK(cost_cents>=0),
  void_reason text, voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(subtotal_cents+tax_cents=total_cents),
  CHECK((source_kind IS NULL AND source_id IS NULL AND source_folio IS NULL AND source_origin IS NULL)
     OR (kind='entrada' AND source_kind IS NOT NULL AND source_id IS NOT NULL AND source_folio IS NOT NULL AND source_origin IS NOT NULL)),
  CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(btrim(void_reason))>0)),
  UNIQUE(source_kind,source_id)
);
CREATE INDEX IF NOT EXISTS admin_movement_date ON administracion.movements(date,kind);
CREATE TABLE IF NOT EXISTS administracion.payments (
  id uuid PRIMARY KEY, movement_id uuid NOT NULL REFERENCES administracion.movements(id),
  date date NOT NULL CHECK(date BETWEEN '2000-01-01' AND '2100-12-31'),
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999),
  method text NOT NULL CHECK(method IN ('efectivo','tarjeta','transferencia','otro')),
  reference text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_payment_movement ON administracion.payments(movement_id);
CREATE TABLE IF NOT EXISTS administracion.commissions (
  id uuid PRIMARY KEY, movement_id uuid NOT NULL UNIQUE REFERENCES administracion.movements(id),
  employee_id uuid NOT NULL REFERENCES administracion.employees(id),
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999),
  paid_on date CHECK(paid_on BETWEEN '2000-01-01' AND '2100-12-31'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administracion.operations (
  id uuid PRIMARY KEY, hash text NOT NULL, action text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administracion.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL, entity_id uuid NOT NULL, details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW administracion.ledger AS
SELECT m.*,
  COALESCE((SELECT sum(p.amount_cents) FROM administracion.payments p WHERE p.movement_id=m.id),0)::bigint AS paid_cents,
  (CASE WHEN m.source_kind='ventas' THEN v.id IS NULL OR COALESCE(v.cancelada,false)
        WHEN m.source_kind='ventas_productos' THEN vp.id IS NULL ELSE false END) AS source_cancelled,
  c.id AS commission_id,c.employee_id,e.name AS employee_name,c.amount_cents AS commission_cents,c.paid_on AS commission_paid_on
FROM administracion.movements m
LEFT JOIN public.ventas v ON m.source_kind='ventas' AND m.source_id=v.id
LEFT JOIN public.ventas_productos vp ON m.source_kind='ventas_productos' AND m.source_id=vp.id
LEFT JOIN administracion.commissions c ON c.movement_id=m.id
LEFT JOIN administracion.employees e ON e.id=c.employee_id;
INSERT INTO administracion.configuration(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
