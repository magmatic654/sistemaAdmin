import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
await fs.access(new URL("../.local/test.env", import.meta.url));
const ownUrl = new URL(process.env.DATABASE_URL),
  sourceUrl = new URL(process.env.SHARED_DATABASE_URL);
for (const target of [ownUrl, sourceUrl]) {
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55439");
}
assert.equal(ownUrl.pathname, "/llantas_admin_tests");
assert.equal(sourceUrl.pathname, "/llantas_admin_source_tests");
assert.equal(process.env.ADMIN_DATABASE_ENVIRONMENT, "development");
assert.equal(process.env.SHARED_DATABASE_ENVIRONMENT, "development");
for (const [target, schema, id] of [
  [ownUrl, "administracion", process.env.ADMIN_DATABASE_ID],
  [sourceUrl, "shared_runtime", process.env.SHARED_DATABASE_ID],
]) {
  const connection = new pg.Client({ connectionString: target.toString() });
  await connection.connect();
  try {
    const identity = (
      await connection.query(
        `SELECT instance_id::text,environment FROM ${schema}.configuration WHERE singleton`,
      )
    ).rows[0];
    assert.equal(identity.instance_id, id);
    assert.equal(identity.environment, "development");
  } finally {
    await connection.end();
  }
}
process.loadEnvFile(new URL("../.local/maintenance.env", import.meta.url));
const maintenanceUrl = new URL(process.env.QA_MAINTENANCE_URL);
assert.equal(maintenanceUrl.hostname, "127.0.0.1");
assert.equal(maintenanceUrl.port, "55439");
assert.equal(maintenanceUrl.pathname, "/postgres");
const owner = new pg.Client({ connectionString: maintenanceUrl.toString() });
await owner.connect();
try {
  const clients = await owner.query(
    "SELECT count(*) FROM pg_stat_activity WHERE datname=ANY($1::text[])",
    [["llantas_admin_tests", "llantas_admin_source_tests"]],
  );
  assert.equal(
    Number(clients.rows[0].count),
    0,
    "Stop the owned QA server before removing its disposable databases.",
  );
  await owner.query("DROP DATABASE llantas_admin_tests");
  await owner.query("DROP DATABASE llantas_admin_source_tests");
  await fs.unlink(new URL("../.local/test.env", import.meta.url));
  console.log(
    "Owned disposable Administration and source QA databases removed. Development databases unchanged.",
  );
} finally {
  await owner.end();
}
