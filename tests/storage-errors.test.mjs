import { test } from "node:test";
import assert from "node:assert/strict";
import { StorageError, storageDiagnostic } from "../lib/errors.ts";
import { databaseSettings, sourceSettings, getClient, getSourceClient } from "../lib/db.ts";

function environment() {
  const original = { ...process.env };
  delete process.env.CENTRAL_INVENTORY_DATABASE_URL;
  Object.assign(process.env, {
    NODE_ENV: "development",
    SHARED_DATABASE_MODE: "true",
    SHARED_DATABASE_ENVIRONMENT: "development",
    SHARED_DATABASE_ID: "12345678-1234-1234-1234-123456789abc",
    ADMIN_DATABASE_ENVIRONMENT: "development",
    ADMIN_DATABASE_ID: "abcdefab-1234-1234-1234-123456789abc",
    DATABASE_URL: "postgresql://writer:private@127.0.0.1:55439/admin",
    SHARED_DATABASE_URL: "postgresql://reader:private@localhost:55439/shared",
  });
  return () => {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  };
}

test("driver failures distinguish connection, authentication, schema, permissions and TLS without exposing secrets", () => {
  for (const [driverCode, expected] of [
    ["ECONNREFUSED", "DATABASE_CONNECTION_FAILED"],
    ["ENOTFOUND", "DATABASE_CONNECTION_FAILED"],
    ["ETIMEDOUT", "DATABASE_CONNECTION_FAILED"],
    ["57P03", "DATABASE_CONNECTION_FAILED"],
    ["28P01", "DATABASE_AUTHENTICATION_FAILED"],
    ["3D000", "DATABASE_NOT_FOUND"],
    ["42P01", "DATABASE_SCHEMA_INCOMPLETE"],
    ["42703", "DATABASE_SCHEMA_INCOMPLETE"],
    ["42501", "DATABASE_PERMISSION_DENIED"],
    ["CERT_HAS_EXPIRED", "DATABASE_TLS_FAILED"],
  ]) {
    const diagnostic = storageDiagnostic(Object.assign(
      new Error("postgresql://private-user:private-password@private-host/private-db"),
      { code: driverCode, detail: "private SQL and values" },
    ));
    assert.equal(diagnostic.code, expected);
    assert.equal(typeof diagnostic.message, "string");
    assert.doesNotMatch(JSON.stringify(diagnostic), /private|postgresql|SQL/);
  }
  assert.equal(
    storageDiagnostic(new Error("Connection terminated due to connection timeout")).code,
    "DATABASE_CONNECTION_FAILED",
  );
  assert.equal(
    storageDiagnostic(new Error("The server does not support SSL connections")).code,
    "DATABASE_TLS_FAILED",
  );
});

test("unknown failures and arbitrary error codes have a static safe fallback", () => {
  for (const error of [
    null,
    "postgresql://private-user:private-password@private-host/private-db",
    new Error("private-password"),
    { code: "private-password", message: "private SQL" },
    { code: "__proto__" },
    { code: "toString" },
  ]) {
    const diagnostic = storageDiagnostic(error);
    assert.equal(diagnostic.code, "OPERATION_UNAVAILABLE");
    assert.equal(typeof diagnostic.message, "string");
    assert.doesNotMatch(JSON.stringify(diagnostic), /private|postgresql|SQL/);
  }
  assert.doesNotMatch(JSON.stringify(storageDiagnostic(
    new StorageError("ADMIN_CONNECTION_INVALID", "private-password"),
  )), /private/);
});

test("configuration diagnostics retain strict separation and identify the missing connection setting", () => {
  const restore = environment();
  try {
    delete process.env.ADMIN_DATABASE_ID;
    assert.throws(databaseSettings, { code: "ADMIN_IDENTITY_INVALID" });
    process.env.ADMIN_DATABASE_ID = "abcdefab-1234-1234-1234-123456789abc";
    delete process.env.SHARED_DATABASE_ENVIRONMENT;
    assert.throws(databaseSettings, { code: "SOURCE_ENVIRONMENT_INVALID" });
    process.env.SHARED_DATABASE_ENVIRONMENT = "development";
    process.env.SHARED_DATABASE_URL = "not-a-connection";
    assert.throws(databaseSettings, { code: "SOURCE_CONNECTION_INVALID" });
    process.env.SHARED_DATABASE_URL = "postgresql://reader@localhost:55439/admin";
    assert.throws(databaseSettings, { code: "DATABASE_SEPARATION_REQUIRED" });
    process.env.CENTRAL_INVENTORY_DATABASE_URL = "";
    assert.throws(databaseSettings, { code: "DATABASE_MODE_INVALID" });
  } finally {
    restore();
  }
});

test("schema, identity and read-only failures remain fail-closed with distinct safe diagnostics", async () => {
  const restore = environment();
  const previousAdmin = global._adminDatabase;
  const previousSource = global._sharedDatabase;
  try {
    for (const scenario of [
      { source: false, identity: { database: "admin", configuration: null }, code: "ADMIN_SCHEMA_MISSING" },
      { source: false, identity: { database: "unexpected", configuration: "administracion.configuration" }, code: "ADMIN_IDENTITY_MISMATCH" },
      { source: false, version: 2, code: "ADMIN_IDENTITY_MISMATCH" },
      { source: true, identity: { database: "shared", configuration: null }, code: "SOURCE_SCHEMA_MISSING" },
      { source: true, version: 2, code: "SOURCE_IDENTITY_MISMATCH" },
      { source: true, readonly: "off", code: "SOURCE_READ_ONLY_REQUIRED" },
    ]) {
      const settings = scenario.source ? sourceSettings() : databaseSettings();
      let released;
      const client = {
        async query(sql) {
          if (sql.startsWith("SELECT current_database()"))
            return { rows: [scenario.identity || { database: settings.database, configuration: "configuration" }] };
          if (sql.startsWith("SELECT version"))
            return { rows: [{ version: scenario.version ?? 1, environment: settings.environment, instance_id: settings.instance }] };
          if (sql === "SHOW transaction_read_only")
            return { rows: [{ transaction_read_only: scenario.readonly ?? "on" }] };
          assert.fail("Unexpected database operation");
        },
        release(broken) { released = broken; },
      };
      global[scenario.source ? "_sharedDatabase" : "_adminDatabase"] = {
        settings,
        pool: { async connect() { return client; } },
      };
      await assert.rejects(scenario.source ? getSourceClient() : getClient(), (error) => {
        assert.equal(storageDiagnostic(error).code, scenario.code);
        assert.doesNotMatch(JSON.stringify(storageDiagnostic(error)), /private|postgresql/);
        return true;
      });
      assert.equal(released, true);
    }
  } finally {
    global._adminDatabase = previousAdmin;
    global._sharedDatabase = previousSource;
    restore();
  }
});
