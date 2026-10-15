import fs from "node:fs/promises";
import { constants } from "node:fs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

// Explicit local setup only. No source business rows are changed or removed.
const privateDir = new URL("../.local/", import.meta.url),
  statePath = new URL("admin-storage-setup.json", privateDir);
await fs.mkdir(privateDir, { recursive: true });
let state;
try {
  state = JSON.parse(await fs.readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!state) {
  const sourceOwnerUrl = process.env.DATABASE_URL;
  const source = new URL(sourceOwnerUrl);
  assert.equal(source.hostname, "127.0.0.1");
  assert.equal(source.port, "55439");
  assert.equal(source.pathname, "/llantas_unified_dev");
  assert.equal(process.env.SHARED_DATABASE_ENVIRONMENT, "development");
  const maintenanceUrl = new URL(source);
  maintenanceUrl.pathname = "/postgres";
  const inspector = new pg.Client({
    connectionString: maintenanceUrl.toString(),
  });
  await inspector.connect();
  try {
    assert.equal(
      (
        await inspector.query(
          "SELECT 1 FROM pg_database WHERE datname='llantas_administracion_dev'",
        )
      ).rowCount,
      0,
      "Refusing to adopt an unknown Administration database.",
    );
    assert.equal(
      (
        await inspector.query(
          "SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])",
          [["sistema_admin_writer", "sistema_admin_source_reader"]],
        )
      ).rowCount,
      0,
      "Refusing to change unknown existing roles.",
    );
  } finally {
    await inspector.end();
  }
  state = {
    sourceOwnerUrl,
    sourceId: process.env.SHARED_DATABASE_ID,
    adminId: randomUUID(),
    writerPassword: randomBytes(32).toString("hex"),
    readerPassword: randomBytes(32).toString("hex"),
    copied: false,
  };
  await fs.writeFile(statePath, JSON.stringify(state), { flag: "wx" });
  await fs.copyFile(
    new URL("../.env.local", import.meta.url),
    new URL("before-separate-storage.env", privateDir),
    constants.COPYFILE_EXCL,
  );
}
const sourceUrl = new URL(state.sourceOwnerUrl);
assert.equal(sourceUrl.hostname, "127.0.0.1");
assert.equal(sourceUrl.port, "55439");
assert.equal(sourceUrl.pathname, "/llantas_unified_dev");
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
const owner = new pg.Client({ connectionString: maintenanceUrl.toString() });
await owner.connect();
const source = new pg.Client({
  connectionString: sourceUrl.toString(),
  options: "-c default_transaction_read_only=on",
});
await source.connect();
let admin;
try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const identity = (
    await source.query(
      "SELECT instance_id::text,environment FROM shared_runtime.configuration WHERE singleton",
    )
  ).rows[0];
  assert.equal(identity.instance_id, state.sourceId);
  assert.equal(identity.environment, "development");
  for (const [role, password] of [
    ["sistema_admin_writer", state.writerPassword],
    ["sistema_admin_source_reader", state.readerPassword],
  ]) {
    assert.match(password, /^[a-f0-9]{64}$/);
    if (
      !(await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    )
      await owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
      );
  }
  await owner.query(
    "ALTER ROLE sistema_admin_source_reader SET default_transaction_read_only=on",
  );
  if (
    !(
      await owner.query(
        "SELECT 1 FROM pg_database WHERE datname='llantas_administracion_dev'",
      )
    ).rowCount
  )
    await owner.query(
      "CREATE DATABASE llantas_administracion_dev OWNER sistema_admin_writer",
    );
  const grants = new pg.Client({ connectionString: sourceUrl.toString() });
  await grants.connect();
  try {
    await grants.query(
      "GRANT CONNECT ON DATABASE llantas_unified_dev TO sistema_admin_source_reader",
    );
    await grants.query(
      "GRANT USAGE ON SCHEMA public,shared_runtime TO sistema_admin_source_reader",
    );
    await grants.query(
      "GRANT SELECT ON public.ventas,public.ventas_productos,shared_runtime.configuration TO sistema_admin_source_reader",
    );
    for (const table of ["public.ventas", "public.ventas_productos"]) {
      const privileges = (
        await grants.query(
          "SELECT has_table_privilege('sistema_admin_source_reader',$1,'INSERT') AS i,has_table_privilege('sistema_admin_source_reader',$1,'UPDATE') AS u,has_table_privilege('sistema_admin_source_reader',$1,'DELETE') AS d",
          [table],
        )
      ).rows[0];
      assert.deepEqual(
        privileges,
        { i: false, u: false, d: false },
        "The source reader must have no write grants.",
      );
    }
  } finally {
    await grants.end();
  }
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/llantas_administracion_dev";
  adminUrl.username = "sistema_admin_writer";
  adminUrl.password = state.writerPassword;
  admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query("BEGIN");
  try {
    for (const name of [
      "001-administration.sql",
      "002-manual-registration.sql",
      "003-commission-settlements.sql",
      "004-offline-manual-sales.sql",
      "005-periods.sql",
      "006-administration-identity.sql",
    ])
      await admin.query(
        await fs.readFile(
          new URL("../database/" + name, import.meta.url),
          "utf8",
        ),
      );
    await admin.query(
      "UPDATE administracion.configuration SET instance_id=$1,environment='development' WHERE singleton",
      [state.adminId],
    );
    if (!state.copied) {
      for (const table of [
        "employees",
        "suppliers",
        "movements",
        "payments",
        "commission_payouts",
        "commissions",
        "operations",
        "audit",
        "preferences",
      ]) {
        const exists = (
          await source.query("SELECT to_regclass($1) AS name", [
            "administracion." + table,
          ])
        ).rows[0].name;
        if (!exists) continue;
        const rows = (
          await source.query(`SELECT * FROM administracion.${table}`)
        ).rows;
        const columns = (
          await source.query(
            "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='administracion' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position",
            [table],
          )
        ).rows;
        for (const row of rows) {
          const names = columns.map((c) => '"' + c.column_name + '"').join(",");
          const params = columns.map((_, i) => "$" + (i + 1)).join(",");
          const values = columns.map((c) =>
            c.data_type === "jsonb"
              ? JSON.stringify(row[c.column_name])
              : row[c.column_name],
          );
          const result = await admin.query(
            `INSERT INTO administracion.${table} (${names}) ${table === "audit" ? "OVERRIDING SYSTEM VALUE" : ""} VALUES(${params}) ON CONFLICT DO NOTHING`,
            values,
          );
          if (!result.rowCount) {
            const key = table === "preferences" ? "singleton" : "id";
            const saved = (
              await admin.query(
                `SELECT * FROM administracion.${table} WHERE ${key}=$1`,
                [row[key]],
              )
            ).rows[0];
            if (table === "preferences")
              await admin.query(
                "UPDATE administracion.preferences SET commission_rate_bps=$1 WHERE singleton",
                [row.commission_rate_bps],
              );
            else
              assert.deepEqual(
                saved,
                row,
                "Existing own records differ from the source copy; refusing to overwrite history.",
              );
          }
        }
        const count = Number(
          (await admin.query(`SELECT count(*) FROM administracion.${table}`))
            .rows[0].count,
        );
        assert.equal(
          count,
          table === "preferences" ? Math.max(rows.length, 1) : rows.length,
          "Incomplete copy of Administration history.",
        );
      }
      await admin.query(
        "SELECT setval(pg_get_serial_sequence('administracion.audit','id'),GREATEST(COALESCE((SELECT max(id) FROM administracion.audit),0),1),EXISTS(SELECT 1 FROM administracion.audit))",
      );
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  state.copied = true;
  await fs.writeFile(statePath, JSON.stringify(state));
  const readerUrl = new URL(sourceUrl);
  readerUrl.username = "sistema_admin_source_reader";
  readerUrl.password = state.readerPassword;
  await fs.writeFile(
    new URL("maintenance.env", privateDir),
    "QA_MAINTENANCE_URL=" + JSON.stringify(maintenanceUrl.toString()) + "\n",
  );
  await fs.writeFile(
    new URL("../.env.local", import.meta.url),
    [
      "DATABASE_URL=" + JSON.stringify(adminUrl.toString()),
      "ADMIN_DATABASE_ID=" + state.adminId,
      "ADMIN_DATABASE_ENVIRONMENT=development",
      "SHARED_DATABASE_URL=" + JSON.stringify(readerUrl.toString()),
      "SHARED_DATABASE_MODE=true",
      "SHARED_DATABASE_ENVIRONMENT=development",
      "SHARED_DATABASE_ID=" + state.sourceId,
      "DB_REQUIRE_SSL=false",
      "SHARED_DB_REQUIRE_SSL=false",
      "DB_SSL_REJECT_UNAUTHORIZED=true",
      "",
    ].join("\n"),
  );
  console.log(
    "Separate Administration database ready. Source connection has SELECT only; source business data and existing history were preserved.",
  );
} finally {
  await admin?.end();
  await source.query("ROLLBACK");
  await source.end();
  await owner.end();
}
