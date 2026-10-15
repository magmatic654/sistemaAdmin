import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  date,
  periodRange,
  businessToday,
  commissionAmount,
  manualLines,
  parseTicketReference,
  ticketReference,
} from "../lib/domain.ts";
import { databaseSettings } from "../lib/db.ts";
test("money uses exact cents and rejects negative, exponent, excessive precision and missing input", () => {
  assert.equal(cents("123.01"), 12301);
  assert.equal(cents("0", undefined, true), 0);
  for (const value of ["-1", "1.001", "1e2", "", null, NaN, "1000000000"])
    assert.throws(() => cents(value));
  assert.equal(
    manualLines([
      { description: "Servicio", quantity: 3, unitPrice: "0.10" },
    ])[0].totalCents,
    30,
  );
});
test("commissions are optional at call site, exactly calculated, and cannot exceed the income", () => {
  assert.equal(commissionAmount(11600, "percent", "10"), 1160);
  assert.equal(commissionAmount(11600, "fixed", "50.01"), 5001);
  assert.throws(() => commissionAmount(11600, "percent", "101"));
  assert.throws(() => commissionAmount(11600, "fixed", "117"));
});
test("calendar ranges use Monday weeks, complete months and Mexico business dates", () => {
  assert.deepEqual(periodRange("day", "2028-02-29"), {
    from: "2028-02-29",
    to: "2028-02-29",
  });
  assert.deepEqual(periodRange("week", "2026-11-01"), {
    from: "2026-10-26",
    to: "2026-11-01",
  });
  assert.deepEqual(periodRange("month", "2028-02-22"), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
  assert.equal(businessToday(new Date("2026-10-15T02:00:00Z")), "2026-10-14");
  assert.throws(() => date("2026-02-30"));
});
test("custom periods accept exact leap dates and inclusive one-day ranges", () => {
  assert.deepEqual(periodRange("custom", "", "2028-02-29", "2028-03-01"), {
    from: "2028-02-29",
    to: "2028-03-01",
  });
  assert.deepEqual(periodRange("custom", "", "2026-10-15", "2026-10-15"), {
    from: "2026-10-15",
    to: "2026-10-15",
  });
  for (const [from, to] of [
    ["2026-02-29", "2026-03-01"],
    ["2028-02-29", "2028-02-30"],
    ["2026-1-01", "2026-01-31"],
    ["2026-01-01", "2026-01-31T00:00:00Z"],
    ["1999-12-31", "2000-01-01"],
    ["2100-12-31", "2101-01-01"],
    [undefined, "2026-01-01"],
    ["2026-01-01", undefined],
    ["2026-10-16", "2026-10-15"],
  ])
    assert.throws(() => periodRange("custom", "", from, to));
});
test("all periods include historical and future pending commissions independently of the current month", () => {
  assert.deepEqual(periodRange("all", "2026-10-15"), {
    from: "2000-01-01",
    to: "2100-12-31",
  });
  assert.deepEqual(periodRange("all", ""), periodRange("all", "2030-01-01"));
  assert.throws(() => periodRange("quarter", "2026-10-15"));
});
test("barcode preserves composite identity, including product and tire IDs that coincide", () => {
  assert.notEqual(
    ticketReference("ventas", "123"),
    ticketReference("ventas_productos", "123"),
  );
  assert.deepEqual(parseTicketReference("LLA1:P:123"), {
    kind: "ventas_productos",
    id: "123",
  });
  assert.equal(parseTicketReference("LLA1:V:../../123"), null);
});
test("database refuses production from development and alternate inventory connections", () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      SHARED_DATABASE_MODE: "true",
      SHARED_DATABASE_ENVIRONMENT: "production",
      NODE_ENV: "development",
    });
    assert.throws(() => databaseSettings(), /producción/);
    process.env.SHARED_DATABASE_ENVIRONMENT = "development";
    process.env.CENTRAL_INVENTORY_DATABASE_URL = "";
    assert.throws(() => databaseSettings(), /exclusivamente/);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
test("administration and shared reads must use separate databases, even with different roles or loopback aliases", () => {
  const original = { ...process.env };
  try {
    delete process.env.CENTRAL_INVENTORY_DATABASE_URL;
    Object.assign(process.env, {
      SHARED_DATABASE_MODE: "true",
      SHARED_DATABASE_ENVIRONMENT: "development",
      SHARED_DATABASE_ID: "12345678-1234-1234-1234-123456789abc",
      ADMIN_DATABASE_ENVIRONMENT: "development",
      ADMIN_DATABASE_ID: "abcdefab-1234-1234-1234-123456789abc",
      DATABASE_URL: "postgresql://writer@127.0.0.1:55439/admin",
      SHARED_DATABASE_URL: "postgresql://reader@localhost:55439/shared",
      NODE_ENV: "development",
    });
    assert.equal(databaseSettings().database, "admin");
    process.env.SHARED_DATABASE_URL =
      "postgresql://reader@localhost:55439/admin";
    assert.throws(() => databaseSettings(), /diferente/);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
