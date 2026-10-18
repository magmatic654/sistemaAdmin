import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentSettings, runDeployment } from "../scripts/deploy-migrate.mjs";

const instance = "d81a8717-33aa-4721-b734-3f66ec5d846a";
const environment = {
  ADMIN_DATABASE_ENVIRONMENT: "production",
  ADMIN_DATABASE_ID: instance,
  DATABASE_URL: "postgresql://writer:secret@admin-db/administracion",
  SHARED_DATABASE_URL: "postgresql://reader:secret@source-db/ventas",
};
const settings = deploymentSettings(environment);

function database({ objects = [], columns = [], identity = [], failOnCreate = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (failOnCreate && sql.startsWith("-- Additive migration"))
        throw Object.assign(new Error("failed migration"), { code: "42501" });
      if (sql.includes("current_database() AS database")) return { rows: [{ database: "administracion" }] };
      if (sql.includes("FROM pg_class c JOIN pg_namespace")) return { rows: objects };
      if (sql.includes("FROM information_schema.columns")) return { rows: columns };
      if (sql.includes("FROM administracion.configuration")) return { rows: identity };
      return { rows: [] };
    },
  };
}
const configuration = {
  objects: [{ schema: "administracion", name: "configuration", kind: "r" }],
  columns: "singleton version installed_at instance_id environment".split(" ")
    .map((column_name) => ({ table_name: "configuration", column_name })),
};
const writes = (client) => client.calls.filter(({ sql }) => /^(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|-- Additive)/.test(sql));

test("production setup requires an explicit UUID, environment and distinct own database", () => {
  assert.throws(() => deploymentSettings({ ...environment, ADMIN_DATABASE_ENVIRONMENT: "development" }), /production/);
  assert.throws(() => deploymentSettings({ ...environment, ADMIN_DATABASE_ID: "" }), /UUID/);
  assert.throws(() => deploymentSettings({ ...environment, SHARED_DATABASE_URL: "" }), /PostgreSQL/);
  assert.throws(() => deploymentSettings({ ...environment, SHARED_DATABASE_ID: instance }), /distintas/);
  assert.throws(() => deploymentSettings({ ...environment,
    DATABASE_URL: "postgresql://owner@localhost:5432/administracion",
    SHARED_DATABASE_URL: "postgres://reader@127.0.0.1/administracion" }), /distintas/);
  assert.throws(() => deploymentSettings({ ...environment,
    DATABASE_URL: environment.DATABASE_URL + "?host=source-db" }), /redirecciones/);
});

test("default deployment inspection never creates an empty schema", async () => {
  const client = database();
  assert.deepEqual(await runDeployment(client, settings), { state: "empty" });
  assert.equal(client.calls[0].sql, "BEGIN READ ONLY");
  assert.deepEqual(writes(client), []);
  assert.equal(client.calls.at(-1).sql, "COMMIT");
});

test("even explicit apply refuses shared identities or source sales before any DDL", async () => {
  for (const object of [
    { schema: "shared_runtime", name: "configuration" },
    { schema: "public", name: "ventas" },
    { schema: "custom", name: "ventas_productos" },
  ]) {
    const client = database({ objects: [object] });
    await assert.rejects(runDeployment(client, settings, { apply: true }), /origen/);
    assert.deepEqual(writes(client), []);
    assert.equal(client.calls.at(-1).sql, "ROLLBACK");
  }
});

test("a mismatching existing identity is never overwritten or adopted", async () => {
  for (const identity of [
    [{ singleton: true, version: 1, environment: "production", instance_id: "other" }],
    [{ singleton: true, version: 1, environment: "development", instance_id: instance }],
    [],
  ]) {
    const client = database({ ...configuration, identity });
    await assert.rejects(runDeployment(client, settings, { apply: true }), /no coincide/);
    assert.deepEqual(writes(client), []);
    assert.equal(client.calls.at(-1).sql, "ROLLBACK");
  }
});

test("partial installations require review instead of replaying migrations over history", async () => {
  const client = database({ ...configuration,
    identity: [{ singleton: true, version: 1, environment: "production", instance_id: instance }] });
  await assert.rejects(runDeployment(client, settings, { apply: true }), /incompleto/);
  assert.deepEqual(writes(client), []);
});

test("failed bootstrap rolls back the production identity together with all schema changes", async () => {
  const client = database({ failOnCreate: true });
  await assert.rejects(runDeployment(client, settings, { apply: true }), /failed migration/);
  const seed = client.calls.find(({ sql }) => sql.startsWith("INSERT INTO administracion.configuration"));
  assert.deepEqual(seed.params, [instance]);
  assert.match(seed.sql, /'production'/);
  assert.equal(client.calls[0].sql, "BEGIN READ WRITE");
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
  assert.equal(client.calls.some(({ sql }) => sql === "COMMIT"), false);
});
