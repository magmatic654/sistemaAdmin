import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const migrations = [
  "001-administration.sql", "002-manual-registration.sql",
  "003-commission-settlements.sql", "004-offline-manual-sales.sql",
  "005-periods.sql", "006-administration-identity.sql", "007-sale-review.sql",
];
const required = {
  configuration: "singleton version installed_at instance_id environment",
  employees: "id name position phone active created_at",
  suppliers: "id name name_key tax_id phone concept category method active created_at",
  movements: "id kind date concept category contact phone supplier_id items subtotal_cents tax_cents total_cents method reference notes source_kind source_id source_folio source_origin cost_cents void_reason voided_at created_at manual_folio manual_origin manual_ticket_code review_status review_version reviewed_at",
  payments: "id movement_id date amount_cents method reference created_at",
  commissions: "id movement_id employee_id amount_cents paid_on created_at rate_bps mode payout_id",
  operations: "id hash action result created_at",
  audit: "id action entity_id details created_at",
  preferences: "singleton commission_rate_bps",
  commission_payouts: "id employee_id period date_from date_to paid_on amount_cents commission_count created_at",
  sale_identity_aliases: "id movement_id folio origin ticket_code created_at",
  manual_ledger: "id kind date items total_cents manual_folio review_status paid_cents source_cancelled commission_id employee_id employee_name commission_cents commission_paid_on",
};

class DeploymentError extends Error {}
const fail = (message) => { throw new DeploymentError(message); };
function connection(value) {
  let url;
  try { url = new URL(value); } catch { fail("Falta una conexión PostgreSQL válida."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname ||
      !url.pathname.slice(1) || decodeURIComponent(url.pathname.slice(1)).includes("/") ||
      [...url.searchParams.keys()].some((key) =>
        ["host", "hostaddr", "port", "database", "dbname", "service", "options"].includes(key.toLowerCase())))
    fail("La conexión PostgreSQL debe identificar una única base sin redirecciones.");
  return {
    url: value,
    host: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

export function deploymentSettings(env = process.env) {
  if (env.ADMIN_DATABASE_ENVIRONMENT !== "production")
    fail("Esta herramienta requiere ADMIN_DATABASE_ENVIRONMENT=production.");
  const instance = env.ADMIN_DATABASE_ID || "";
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(instance))
    fail("Configura el UUID esperado en ADMIN_DATABASE_ID antes de instalar.");
  const own = connection(env.DATABASE_URL), source = connection(env.SHARED_DATABASE_URL);
  if ((own.host === source.host && own.port === source.port && own.database === source.database) ||
      instance.toLowerCase() === env.SHARED_DATABASE_ID?.toLowerCase())
    fail("La base y la identidad de Administración deben ser distintas de las compartidas.");
  return { ...own, instance: instance.toLowerCase() };
}

export async function inspectDatabase(client, settings) {
  const database = (await client.query("SELECT current_database() AS database")).rows[0]?.database;
  if (database !== settings.database) fail("La conexión no llegó a la base propia esperada.");
  const objects = (await client.query(`
    SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND c.relkind IN ('r','p','v','m','S','f')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
        AND d.objid=c.oid AND d.deptype='e')
  `)).rows;
  if (objects.some((o) => (o.schema === "shared_runtime" && o.name === "configuration") ||
      ["ventas", "ventas_productos"].includes(o.name)))
    fail("Se detectó una base de ventas de origen. No se permite instalar Administración aquí.");
  if (objects.length === 0) return { state: "empty" };
  if (!objects.some((o) => o.schema === "administracion" && o.name === "configuration"))
    fail("La base no está vacía ni tiene una identidad de Administración reconocible.");
  const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='administracion'`)).rows;
  if (required.configuration.split(" ").some((name) =>
      !columns.some((c) => c.table_name === "configuration" && c.column_name === name)))
    fail("La instalación de Administración está incompleta. Requiere una reparación revisada.");
  const identity = (await client.query(`SELECT singleton,version,environment,instance_id::text
    FROM administracion.configuration`)).rows;
  if (identity.length !== 1 || identity[0].singleton !== true || identity[0].version !== 1 ||
      identity[0].environment !== "production" || identity[0].instance_id !== settings.instance)
    fail("La identidad existente no coincide. No se sobrescribirá ni se adoptará esta base.");
  const missing = Object.entries(required).flatMap(([table, names]) => names.split(" ")
    .filter((name) => !columns.some((c) => c.table_name === table && c.column_name === name)));
  const missingRelations = Object.keys(required).some((table) => !objects.some((o) =>
    o.schema === "administracion" && o.name === table &&
    (table === "manual_ledger" ? o.kind === "v" : ["r", "p"].includes(o.kind))));
  const protections = (await client.query(`
    SELECT tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='administracion' AND NOT t.tgisinternal AND t.tgenabled<>'D'
      AND ((c.relname='commissions' AND tgname='protect_paid_commission')
        OR (c.relname='movements' AND tgname='admin_default_sale_review'))
  `)).rows;
  const uniqueIndexes = ["admin_manual_folio", "admin_manual_ticket_code", "admin_sale_alias_identity",
    "movements_source_kind_source_id_key", "commissions_movement_id_key"];
  const constraints = ["admin_income_identity", "admin_manual_identity", "admin_sale_review",
    "admin_sale_review_version", "commission_payouts_period_check"];
  const guards = (await client.query(`SELECT
    (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='administracion'
      AND c.relname=ANY($1::text[]) AND i.indisunique AND i.indisvalid) AS unique_indexes,
    (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='administracion' AND c.conname=ANY($2::text[])
      AND c.convalidated) AS constraints`, [uniqueIndexes, constraints])).rows[0];
  if (missing.length || missingRelations || protections.length !== 2 ||
      guards?.unique_indexes !== uniqueIndexes.length || guards?.constraints !== constraints.length)
    fail("El esquema de Administración está incompleto. Requiere una reparación revisada.");
  return { state: "installed" };
}

// Existing installations are verified only: replaying 001 changes the expanded
// view's column order; 007 also backfills historical review states. Never replay
// these migrations over business records without a separately reviewed upgrade.
export async function runDeployment(client, settings, { apply = false } = {}) {
  await client.query(apply ? "BEGIN READ WRITE" : "BEGIN READ ONLY");
  try {
    if (apply) await client.query("SELECT pg_advisory_xact_lock(180910007)");
    let result = await inspectDatabase(client, settings);
    if (apply && result.state === "empty") {
      // Seed the correct identity before 001's legacy default INSERT. The table
      // definition matches 001+006; neither an existing identity nor data is reset.
      await client.query(`CREATE SCHEMA administracion;
        CREATE TABLE administracion.configuration (
          singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
          version integer NOT NULL CHECK(version=1),
          installed_at timestamptz NOT NULL DEFAULT now(),
          instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
          environment text NOT NULL DEFAULT 'development' CHECK(environment IN ('development','production'))
        )`);
      await client.query(`INSERT INTO administracion.configuration
        (singleton,version,instance_id,environment) VALUES(true,1,$1,'production')`, [settings.instance]);
      for (const name of migrations)
        await client.query(await fs.readFile(new URL("../database/" + name, import.meta.url), "utf8"));
      result = await inspectDatabase(client, settings);
      if (result.state !== "installed") fail("No se pudo verificar la instalación completa.");
      result = { state: "created" };
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node scripts/deploy-migrate.mjs [--check | --apply]\nSin --apply sólo se inspecciona. Usa las variables del servidor, sin cargar .env.local.");
    return;
  }
  if (args.some((arg) => !["--check", "--apply"].includes(arg)) ||
      (args.includes("--check") && args.includes("--apply"))) fail("Usa --check o --apply.");
  const settings = deploymentSettings();
  const client = new pg.Client({
    connectionString: settings.url,
    application_name: "administracion_schema_deployment",
    connectionTimeoutMillis: 10000,
    options: "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000",
    ssl: process.env.DB_REQUIRE_SSL === "true"
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
  try {
    await client.connect();
    const { state } = await runDeployment(client, settings, { apply: args.includes("--apply") });
    console.log(state === "empty"
      ? "Base propia vacía. No se hicieron cambios. Revisa la configuración y usa --apply para instalar."
      : state === "created" ? "Esquema de Administración instalado y verificado. No se crearon registros de negocio."
      : "Identidad y esquema de Administración verificados. No se modificaron registros existentes.");
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof DeploymentError ? error.message
      : "La verificación o instalación falló; no se confirmaron cambios. Código: " +
        (/^[A-Z0-9_]{2,30}$/.test(error.code || "") ? error.code : "DATABASE_ERROR"));
    process.exitCode = 1;
  });
