import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import pg from "pg";

// Explicit one-time credential setup. Never migrates or changes business rows.
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const connectionFile = argument("--connection-file");
const expectedInstance = argument("--instance");
const expectedCluster = argument("--cluster");
assert.ok(process.argv.includes("--connection-file") && connectionFile);
assert.match(
  expectedInstance || "",
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i,
);
assert.match(expectedCluster || "", /^\d{10,25}$/);
const configuration = JSON.parse(await fs.readFile(connectionFile, "utf8"));
assert.equal(configuration.host, "72.62.83.230");
assert.equal(configuration.port, 7453);
assert.equal(configuration.database, "postgres");
const role = "sistema_administracion_reader";
const directory = new URL("../.local/", import.meta.url);
await fs.mkdir(directory, { recursive: true });
const stateFile = new URL("production-source-setup.json", directory);
let state;
try {
  state = JSON.parse(await fs.readFile(stateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const owner = new pg.Client({
  ...configuration,
  application_name: "administracion_reader_permission_setup",
  options: "-c default_transaction_read_only=on -c statement_timeout=15000",
  connectionTimeoutMillis: 10000,
});
let reader;
try {
  await owner.connect();
  const identity = (
    await owner.query(`SELECT current_database() AS database,
    version,environment,instance_id::text,
    (SELECT system_identifier::text FROM pg_control_system()) AS cluster
    FROM shared_runtime.configuration WHERE singleton`)
  ).rows;
  assert.equal(identity.length, 1);
  assert.deepEqual(identity[0], {
    database: configuration.database,
    version: 1,
    environment: "production",
    instance_id: expectedInstance,
    cluster: expectedCluster,
  });
  const existing = await owner.query(
    "SELECT 1 FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (!state) {
    assert.equal(
      existing.rowCount,
      0,
      "Refusing to adopt an unknown existing reader role.",
    );
    state = {
      role,
      host: configuration.host,
      port: configuration.port,
      database: configuration.database,
      instance: expectedInstance,
      cluster: expectedCluster,
      password: randomBytes(32).toString("hex"),
    };
    await fs.writeFile(stateFile, JSON.stringify(state), { flag: "wx" });
  }
  for (const field of [
    "role",
    "host",
    "port",
    "database",
    "instance",
    "cluster",
  ])
    assert.equal(
      state[field],
      {
        role,
        host: configuration.host,
        port: configuration.port,
        database: configuration.database,
        instance: expectedInstance,
        cluster: expectedCluster,
      }[field],
    );
  assert.match(state.password, /^[a-f\d]{64}$/);
  if (!existing.rowCount) {
    await owner.query("BEGIN READ WRITE");
    try {
      await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${state.password}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10`);
      await owner.query(
        `ALTER ROLE ${role} SET default_transaction_read_only=on`,
      );
      await owner.query(`GRANT CONNECT ON DATABASE postgres TO ${role}`);
      await owner.query(
        `GRANT USAGE ON SCHEMA public,shared_runtime TO ${role}`,
      );
      await owner.query(
        `GRANT SELECT ON public.ventas,public.ventas_productos,shared_runtime.configuration TO ${role}`,
      );
      const permissions = (
        await owner.query(
          `SELECT
        has_schema_privilege($1,'public','CREATE') AS can_create_public,
        has_schema_privilege($1,'shared_runtime','CREATE') AS can_create_shared,
        EXISTS(SELECT 1 FROM (VALUES('public.ventas'),('public.ventas_productos'),('shared_runtime.configuration')) t(name)
          CROSS JOIN (VALUES('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
          WHERE has_table_privilege($1,t.name,p.privilege)) AS can_write`,
          [role],
        )
      ).rows[0];
      assert.deepEqual(permissions, {
        can_create_public: false,
        can_create_shared: false,
        can_write: false,
      });
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
  }
  reader = new pg.Client({
    ...configuration,
    user: role,
    password: state.password,
    application_name: "administracion_reader_verification",
    options: "-c default_transaction_read_only=on -c statement_timeout=15000",
    connectionTimeoutMillis: 10000,
  });
  await reader.connect();
  const actual = (
    await reader.query(`SELECT current_database() AS database,version,environment,instance_id::text
    FROM shared_runtime.configuration WHERE singleton`)
  ).rows[0];
  assert.deepEqual(actual, {
    database: configuration.database,
    version: 1,
    environment: "production",
    instance_id: expectedInstance,
  });
  assert.equal(
    (await reader.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only,
    "on",
  );
  const appFile = new URL("../.env.local", import.meta.url);
  const contents = await fs.readFile(appFile, "utf8");
  const current = parseEnv(contents);
  const own = new URL(current.DATABASE_URL);
  assert.equal(own.hostname, "127.0.0.1");
  assert.equal(own.port, "55439");
  assert.equal(own.pathname, "/llantas_administracion_dev");
  assert.equal(current.ADMIN_DATABASE_ENVIRONMENT, "development");
  const developmentFile = new URL("development.env", directory);
  try {
    await fs.access(developmentFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert.equal(
      current.SHARED_DATABASE_ENVIRONMENT,
      "development",
      "A private local-only integration profile is required before changing the source.",
    );
    const localSource = new URL(current.SHARED_DATABASE_URL);
    assert.equal(localSource.hostname, "127.0.0.1");
    assert.equal(localSource.port, "55439");
    assert.equal(localSource.pathname, "/llantas_unified_dev");
    await fs.writeFile(developmentFile, contents, { flag: "wx" });
  }
  const url = new URL("postgresql://placeholder");
  url.hostname = configuration.host;
  url.port = String(configuration.port);
  url.pathname = "/" + configuration.database;
  url.username = role;
  url.password = state.password;
  const changes = {
    SHARED_DATABASE_URL: JSON.stringify(url.toString()),
    SHARED_DATABASE_ENVIRONMENT: "production",
    SHARED_DATABASE_ID: expectedInstance,
    SHARED_DATABASE_ALLOW_PRODUCTION_READS: "true",
    SHARED_DB_REQUIRE_SSL: configuration.ssl === false ? "false" : "true",
  };
  // Do not silently weaken an installed TLS policy or discard a required CA.
  assert.ok(
    configuration.ssl === false || configuration.ssl === true,
    "Install the reviewed CA explicitly before using a custom TLS configuration.",
  );
  Object.assign(process.env, current, {
    SHARED_DATABASE_URL: url.toString(),
    SHARED_DATABASE_ENVIRONMENT: "production",
    SHARED_DATABASE_ID: expectedInstance,
    SHARED_DATABASE_ALLOW_PRODUCTION_READS: "true",
    SHARED_DB_REQUIRE_SSL: changes.SHARED_DB_REQUIRE_SSL,
  });
  const { getSourceClient } = await import("../lib/db.ts");
  const verifiedReader = await getSourceClient();
  verifiedReader.release();
  let updated = contents;
  for (const [key, value] of Object.entries(changes)) {
    const pattern = new RegExp("^" + key + "=.*$", "m");
    updated = pattern.test(updated)
      ? updated.replace(pattern, key + "=" + value)
      : updated.trimEnd() + "\n" + key + "=" + value + "\n";
  }
  await fs.writeFile(appFile, updated);
  console.log(
    "Production ticket source configured with its own SELECT-only account. Administration storage unchanged; business rows untouched.",
  );
} catch (error) {
  console.error(
    "Reader configuration failed before activation. Code: " +
      (error.code || error.name),
  );
  process.exitCode = 1;
} finally {
  await global._sharedDatabase?.pool.end();
  await reader?.end();
  await owner.end();
}
