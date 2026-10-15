import fs from "node:fs/promises";
import { getClient } from "../lib/db.ts";
const check = process.argv.includes("--check");
// Development migration is intentionally confined to the prepared local instance.
// Production runs require a reviewed deployment migration, never this dev helper.
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid");
if (
  process.env.SHARED_DATABASE_ENVIRONMENT !== "development" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  !["/llantas_unified_dev", "/llantas_admin_tests"].includes(url.pathname)
)
  throw Error(
    "This helper only accepts the explicit local development or administration test database.",
  );
const client = await getClient();
try {
  if (!check) {
    await client.query("BEGIN");
    try {
      for (const name of [
        "001-administration.sql",
        "002-manual-registration.sql",
      ])
        await client.query(
          await fs.readFile(
            new URL("../database/" + name, import.meta.url),
            "utf8",
          ),
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  const { rows } = await client.query(
    "SELECT version FROM administracion.configuration WHERE singleton IS TRUE",
  );
  if (rows.length !== 1 || rows[0].version !== 1)
    throw Error("Incompatible administration schema.");
  console.log(
    "Administration schema v1 verified. Shared sales and stock are unchanged.",
  );
} finally {
  client.release();
  await global._adminDatabase?.pool.end();
}
