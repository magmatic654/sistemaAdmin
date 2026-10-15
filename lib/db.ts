import { Pool, type PoolClient, type QueryResultRow } from "pg";

type Settings = {
  url: string;
  database: string;
  instance: string;
  environment: string;
};
declare global {
  var _adminDatabase: { pool: Pool; settings: Settings } | undefined;
  var _sharedDatabase: { pool: Pool; settings: Settings } | undefined;
}
function configuration(source: boolean): Settings {
  if (
    process.env.SHARED_DATABASE_MODE !== "true" ||
    process.env.CENTRAL_INVENTORY_DATABASE_URL !== undefined
  )
    throw Error(
      "Administración requiere exclusivamente la conexión compartida de lectura y su base propia.",
    );
  if (
    process.env.ADMIN_DATABASE_ENVIRONMENT === "production" &&
    process.env.NODE_ENV !== "production"
  )
    throw Error("Desarrollo no puede operar la base de producción.");
  if (
    process.env.SHARED_DATABASE_ENVIRONMENT === "production" &&
    (process.env.NODE_ENV === "test" ||
      (process.env.NODE_ENV !== "production" &&
        process.env.SHARED_DATABASE_ALLOW_PRODUCTION_READS !== "true"))
  )
    throw Error(
      "La lectura de producción requiere autorización explícita y no está permitida en pruebas.",
    );
  const environment =
    process.env[
      source ? "SHARED_DATABASE_ENVIRONMENT" : "ADMIN_DATABASE_ENVIRONMENT"
    ];
  if (!["development", "production"].includes(environment || ""))
    throw Error(
      "Configura el entorno de la base de " +
        (source ? "origen." : "Administración."),
    );
  const instance =
    process.env[source ? "SHARED_DATABASE_ID" : "ADMIN_DATABASE_ID"] || "";
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(instance))
    throw Error(
      "Configura la identidad de la base de " +
        (source ? "origen." : "Administración."),
    );
  const url =
    process.env[source ? "SHARED_DATABASE_URL" : "DATABASE_URL"] || "";
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.pathname.slice(1) ||
      decodeURIComponent(parsed.pathname.slice(1)).includes("/")
    )
      throw Error();
  } catch {
    throw Error(
      "Configura una conexión PostgreSQL válida para " +
        (source ? "lectura compartida." : "Administración."),
    );
  }
  return {
    url,
    database: decodeURIComponent(parsed.pathname.slice(1)),
    instance: instance.toLowerCase(),
    environment: environment!,
  };
}
export function databaseSettings(): Settings {
  const settings = configuration(false),
    source = configuration(true);
  const ownUrl = new URL(settings.url),
    sourceUrl = new URL(source.url);
  const host = (url: URL) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? "loopback"
      : url.hostname;
  if (
    host(ownUrl) === host(sourceUrl) &&
    (ownUrl.port || "5432") === (sourceUrl.port || "5432") &&
    settings.database === source.database
  )
    throw Error(
      "Administración debe usar una base diferente de la compartida.",
    );
  return settings;
}
export function sourceSettings(): Settings {
  return configuration(true);
}

type ReaderRoleAccess = {
  superuser: boolean;
  create_database: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  database_owner: boolean;
  same_role: boolean;
};
type ReaderTableAccess = {
  table_name: string;
  select_allowed: boolean;
  insert_allowed: boolean;
  update_allowed: boolean;
  delete_allowed: boolean;
  truncate_allowed: boolean;
  references_allowed: boolean;
  trigger_allowed: boolean;
};
type ReaderSchemaAccess = { schema_name: string; create_allowed: boolean };
const readerTables = [
  "public.ventas",
  "public.ventas_productos",
  "shared_runtime.configuration",
] as const;
const readerSchemas = ["public", "shared_runtime"] as const;

/** Fail closed when effective production access exceeds the dedicated reader. */
export function validateProductionReaderAccess(
  role: ReaderRoleAccess | undefined,
  tables: ReaderTableAccess[],
  schemas: ReaderSchemaAccess[],
): void {
  const deniedFlags: (keyof ReaderRoleAccess)[] = [
    "superuser",
    "create_database",
    "create_role",
    "replication",
    "bypass_rls",
    "database_owner",
  ];
  const deniedTableFlags: (keyof ReaderTableAccess)[] = [
    "insert_allowed",
    "update_allowed",
    "delete_allowed",
    "truncate_allowed",
    "references_allowed",
    "trigger_allowed",
  ];
  if (
    !role ||
    role.same_role !== true ||
    deniedFlags.some((flag) => role[flag] !== false) ||
    tables.length !== readerTables.length ||
    readerTables.some((name) => {
      const matches = tables.filter((table) => table.table_name === name);
      return (
        matches.length !== 1 ||
        matches[0].select_allowed !== true ||
        deniedTableFlags.some((flag) => matches[0][flag] !== false)
      );
    }) ||
    schemas.length !== readerSchemas.length ||
    readerSchemas.some((name) => {
      const matches = schemas.filter((schema) => schema.schema_name === name);
      return matches.length !== 1 || matches[0].create_allowed !== false;
    })
  )
    throw Error(
      "La conexión de producción requiere un usuario exclusivo de sólo lectura, sin propiedad ni permisos de escritura o creación.",
    );
}

async function verifyProductionReader(client: PoolClient): Promise<void> {
  const role = await client.query<ReaderRoleAccess>(`
    SELECT bool_or(r.rolsuper) AS superuser,
      bool_or(r.rolcreatedb) AS create_database,
      bool_or(r.rolcreaterole) AS create_role,
      bool_or(r.rolreplication) AS replication,
      bool_or(r.rolbypassrls) AS bypass_rls,
      bool_or(pg_has_role(r.oid, d.datdba, 'MEMBER')) AS database_owner,
      current_user = session_user AS same_role
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname IN (current_user, session_user)
      AND d.datname = current_database()
  `);
  const tables = await client.query<ReaderTableAccess>(
    `
    SELECT table_name,
      has_table_privilege(current_user, table_name, 'SELECT') AS select_allowed,
      (has_table_privilege(current_user, table_name, 'INSERT') OR
        has_any_column_privilege(current_user, table_name, 'INSERT')) AS insert_allowed,
      (has_table_privilege(current_user, table_name, 'UPDATE') OR
        has_any_column_privilege(current_user, table_name, 'UPDATE')) AS update_allowed,
      has_table_privilege(current_user, table_name, 'DELETE') AS delete_allowed,
      has_table_privilege(current_user, table_name, 'TRUNCATE') AS truncate_allowed,
      (has_table_privilege(current_user, table_name, 'REFERENCES') OR
        has_any_column_privilege(current_user, table_name, 'REFERENCES')) AS references_allowed,
      has_table_privilege(current_user, table_name, 'TRIGGER') AS trigger_allowed
    FROM unnest($1::text[]) AS expected(table_name)
  `,
    [[...readerTables]],
  );
  const schemas = await client.query<ReaderSchemaAccess>(
    `
    SELECT schema_name,
      has_schema_privilege(current_user, schema_name, 'CREATE') AS create_allowed
    FROM unnest($1::text[]) AS expected(schema_name)
  `,
    [[...readerSchemas]],
  );
  validateProductionReaderAccess(role.rows[0], tables.rows, schemas.rows);
}

async function checkout(source: boolean): Promise<PoolClient> {
  const settings = source ? sourceSettings() : databaseSettings(),
    previous = source ? global._sharedDatabase : global._adminDatabase;
  let entry = previous;
  if (!entry || JSON.stringify(entry.settings) !== JSON.stringify(settings)) {
    entry = {
      settings,
      pool: new Pool({
        connectionString: settings.url,
        application_name: source
          ? "sistema_admin_source_readonly"
          : "sistema_administracion",
        max: 5,
        connectionTimeoutMillis: 5000,
        options:
          "-c timezone=America/Mexico_City -c search_path=public -c statement_timeout=15000" +
          (source ? " -c default_transaction_read_only=on" : ""),
        ssl:
          process.env[source ? "SHARED_DB_REQUIRE_SSL" : "DB_REQUIRE_SSL"] ===
          "true"
            ? {
                rejectUnauthorized:
                  process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
              }
            : undefined,
      }),
    };
    if (source) global._sharedDatabase = entry;
    else global._adminDatabase = entry;
    if (previous) void previous.pool.end();
  }
  const client = await entry.pool.connect();
  try {
    const schema = source ? "shared_runtime" : "administracion";
    const identity = await client.query(
      `SELECT current_database() AS database,to_regclass('${schema}.configuration')::text AS configuration`,
    );
    if (
      identity.rows[0]?.database !== settings.database ||
      !identity.rows[0]?.configuration
    )
      throw Error("La base no tiene la identidad esperada.");
    const { rows } = await client.query(
      `SELECT version,environment,instance_id::text FROM ${schema}.configuration WHERE singleton IS TRUE`,
    );
    if (
      rows.length !== 1 ||
      rows[0].version !== 1 ||
      rows[0].environment !== settings.environment ||
      rows[0].instance_id !== settings.instance
    )
      throw Error("La versión, entorno o instancia de la base no coincide.");
    if (
      source &&
      (await client.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only !== "on"
    )
      throw Error("La conexión compartida debe ser de sólo lectura.");
    if (source && settings.environment === "production")
      await verifyProductionReader(client);
    return client;
  } catch (error) {
    client.release(true);
    throw error;
  }
}
export const getClient = () => checkout(false);
export const getSourceClient = () => checkout(true);
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  const client = await getClient();
  try {
    return await client.query<T>(sql, values);
  } finally {
    client.release();
  }
}
export async function queryShared<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  const client = await getSourceClient();
  try {
    return await client.query<T>(sql, values);
  } finally {
    client.release();
  }
}
export async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await getClient();
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
