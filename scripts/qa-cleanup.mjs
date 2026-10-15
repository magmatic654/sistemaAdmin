import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55439");
assert.equal(target.pathname, "/llantas_admin_tests");
assert.equal(process.env.SHARED_DATABASE_ENVIRONMENT, "development");
await fs.access(new URL("../.local/test.env", import.meta.url));
const clone = new pg.Client({ connectionString: target.toString() });
await clone.connect();
try {
  const identity = (
    await clone.query(
      "SELECT instance_id,environment FROM shared_runtime.configuration",
    )
  ).rows[0];
  assert.equal(identity.instance_id, process.env.SHARED_DATABASE_ID);
  assert.equal(identity.environment, "development");
} finally {
  await clone.end();
}
target.pathname = "/postgres";
const owner = new pg.Client({ connectionString: target.toString() });
await owner.connect();
try {
  const clients = await owner.query(
    "SELECT count(*) FROM pg_stat_activity WHERE datname='llantas_admin_tests'",
  );
  assert.equal(
    Number(clients.rows[0].count),
    0,
    "Stop the owned QA server before removing its disposable database.",
  );
  await owner.query("DROP DATABASE llantas_admin_tests");
  await fs.unlink(new URL("../.local/test.env", import.meta.url));
  console.log(
    "Owned disposable QA database removed. Development base unchanged.",
  );
} finally {
  await owner.end();
}
