import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const administration = new URL(
  process.env.DATABASE_URL || "postgresql://invalid",
);
const source = new URL(
  process.env.SHARED_DATABASE_URL || "postgresql://invalid",
);
for (const url of [administration, source]) {
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
}
assert.equal(administration.pathname, "/llantas_administracion_dev");
assert.equal(source.pathname, "/llantas_unified_dev");
assert.equal(process.env.ADMIN_DATABASE_ENVIRONMENT, "development");
assert.equal(process.env.SHARED_DATABASE_ENVIRONMENT, "development");
const database = "llantas_admin_tests";
const sourceDatabase = "llantas_admin_source_tests";
process.loadEnvFile(
  fileURLToPath(new URL("../.local/maintenance.env", import.meta.url)),
);
const maintenanceUrl = new URL(
  process.env.QA_MAINTENANCE_URL || "postgresql://invalid",
);
assert.equal(maintenanceUrl.hostname, "127.0.0.1");
assert.equal(maintenanceUrl.port, "55439");
assert.equal(maintenanceUrl.pathname, "/postgres");
const owner = new pg.Client({ connectionString: maintenanceUrl.toString() });
let created = false,
  sourceCreated = false,
  connection,
  migrator,
  sourceWriter;
async function test(name, operation) {
  await operation();
  console.log("PASS " + name);
}
try {
  await owner.connect();
  const existing = await owner.query(
    "SELECT 1 FROM pg_database WHERE datname=ANY($1::text[])",
    [[database, sourceDatabase]],
  );
  assert.equal(
    existing.rows.length,
    0,
    "A test database already exists. Inspect it; never overwrite an unknown database.",
  );
  // No test writes go to the development base. The entire disposable clone is owned by this run.
  await owner.query(
    "CREATE DATABASE llantas_admin_tests TEMPLATE llantas_administracion_dev",
  );
  created = true;
  await owner.query(
    "CREATE DATABASE llantas_admin_source_tests TEMPLATE llantas_unified_dev",
  );
  sourceCreated = true;
  const target = new URL(administration);
  target.pathname = "/" + database;
  const sourceTarget = new URL(source);
  sourceTarget.pathname = "/" + sourceDatabase;
  const sourceOwnerTarget = new URL(maintenanceUrl);
  sourceOwnerTarget.pathname = "/" + sourceDatabase;
  process.env.DATABASE_URL = target.toString();
  process.env.SHARED_DATABASE_URL = sourceTarget.toString();
  connection = new pg.Client({ connectionString: target.toString() });
  await connection.connect();
  const migrationTarget = new URL(maintenanceUrl);
  migrationTarget.pathname = "/" + database;
  migrator = new pg.Client({ connectionString: migrationTarget.toString() });
  await migrator.connect();
  sourceWriter = new pg.Client({
    connectionString: sourceOwnerTarget.toString(),
  });
  await sourceWriter.connect();
  const sourceIdentity = await sourceWriter.query(
    "SELECT environment,instance_id FROM shared_runtime.configuration",
  );
  assert.equal(sourceIdentity.rows[0].environment, "development");
  assert.equal(
    sourceIdentity.rows[0].instance_id,
    process.env.SHARED_DATABASE_ID,
  );
  for (const name of [
    "001-administration.sql",
    "002-manual-registration.sql",
    "003-commission-settlements.sql",
    "004-offline-manual-sales.sql",
    "005-periods.sql",
    "006-administration-identity.sql",
    "007-sale-review.sql",
  ])
    await migrator.query(
      await fs.readFile(
        new URL("../database/" + name, import.meta.url),
        "utf8",
      ),
    );
  // Recreating the ledger view during migration resets that view's cloned ACL.
  const writerRole = decodeURIComponent(administration.username);
  assert.match(writerRole, /^[a-z_][a-z0-9_]*$/i);
  await migrator.query(
    `GRANT SELECT ON administracion.manual_ledger TO "${writerRole}"`,
  );
  await migrator.query(
    `GRANT SELECT,INSERT,UPDATE ON administracion.sale_identity_aliases TO "${writerRole}"`,
  );
  await migrator.query(
    `GRANT USAGE ON SEQUENCE administracion.sale_identity_aliases_id_seq TO "${writerRole}"`,
  );
  const identity = await connection.query(
    "SELECT environment,instance_id FROM administracion.configuration",
  );
  assert.equal(identity.rows[0].environment, "development");
  assert.equal(identity.rows[0].instance_id, process.env.ADMIN_DATABASE_ID);
  const { mutate, getState, lookupSales, movementDetail, payoutPreview } =
    await import("../lib/data.ts");
  const { getSourceClient } = await import("../lib/db.ts");
  const { businessToday } = await import("../lib/domain.ts");
  const day = businessToday(),
    params = new URLSearchParams({ from: day, to: day });
  const run = (action, payload, id = randomUUID()) =>
    mutate(action, payload, id);
  async function approve(id) {
    const { movement } = await movementDetail(id);
    return run("movement.review.approve", {
      id,
      reviewVersion: movement.review_version,
    });
  }
  const service = (
    await sourceWriter.query("SELECT id,nombre FROM public.servicios LIMIT 1")
  ).rows[0];
  assert.ok(service);
  await test("the shared connection is read-only and the administration database is separate", async () => {
    assert.equal(
      (
        await connection.query(
          "SELECT to_regclass('public.ventas') AS table_name",
        )
      ).rows[0].table_name,
      null,
    );
    await sourceWriter.query(
      "CREATE TABLE public.admin_readonly_probe(id integer)",
    );
    const reader = await getSourceClient();
    try {
      assert.equal(
        (await reader.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
      const permissions = (
        await reader.query(
          `SELECT has_table_privilege(current_user,'public.ventas','INSERT') AS can_insert,
          has_table_privilege(current_user,'public.ventas','UPDATE') AS can_update,
          has_table_privilege(current_user,'public.ventas','DELETE') AS can_delete,
          has_schema_privilege(current_user,'public','CREATE') AS can_create,
          rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`,
        )
      ).rows[0];
      for (const allowed of Object.values(permissions))
        assert.equal(allowed, false);
      for (const statement of [
        "INSERT INTO public.ventas SELECT * FROM public.ventas WHERE false",
        "UPDATE public.ventas SET folio=folio WHERE false",
        "DROP TABLE public.admin_readonly_probe",
      ])
        await assert.rejects(reader.query(statement), (error) =>
          ["25006", "42501"].includes(error.code),
        );
      assert.equal(
        (
          await sourceWriter.query(
            "SELECT count(*) FROM public.admin_readonly_probe",
          )
        ).rows[0].count,
        "0",
      );
    } finally {
      reader.release();
      await sourceWriter.query("DROP TABLE public.admin_readonly_probe");
    }
  });
  async function ticket(origin = "negra", overrides = {}) {
    const id = overrides.id || "admin-qa-" + randomUUID();
    const item = {
      tipo: "servicio",
      servicioId: service.id,
      servicioNombre: "Servicio de integración",
      cantidad: 1,
      precioUnitario: 232,
      subtotal: 232,
      costoUnitario: null,
      costoSubtotal: null,
    };
    await sourceWriter.query(
      `INSERT INTO public.ventas(id,folio,cliente,items,subtotal,iva,total,"metodoPago","fechaVenta",origen_app,garantia)
      VALUES($1,$2,$3::jsonb,$4::jsonb,200,32,232,'efectivo',now(),$5,$6::jsonb)`,
      [
        id,
        overrides.folio || "QA-" + randomUUID().slice(0, 8),
        JSON.stringify({ nombre: "Cliente ticket QA" }),
        JSON.stringify([item]),
        origin,
        JSON.stringify({
          id: "",
          diasGarantia: 0,
          activa: false,
          fechaInicio: "",
          fechaFin: "",
        }),
      ],
    );
    return id;
  }
  const manualId = await ticket();
  await test("existing sales never appear until an administrator explicitly registers them", async () => {
    const state = await getState(params);
    assert.equal(state.summary.income, 0);
    assert.equal(state.movements.length, 0);
    assert.equal(state.providerNames.length, 0);
  });
  const employee = await run("employee.save", {
    name: "Empleado QA",
    position: "Técnico",
    phone: "",
  });
  const supplier = await run("supplier.save", {
    name: "Proveedor QA",
    phone: "",
    tax_id: "",
    concept: "Compra habitual",
    category: "Compra de productos",
    method: "transferencia",
  });
  const input = {
    kind: "entrada",
    ticketCode: "LLA1:V:" + manualId,
    date: day,
    concept: "Servicio QA",
    category: "Venta de servicios",
    contact: "Público QA",
    phone: "",
    items: [{ description: "Servicio QA", quantity: 1, unitPrice: "116.00" }],
    vatIncluded: true,
    method: "efectivo",
    received: "116.00",
    notes: "",
    reference: "",
    commission: { employeeId: employee.id, mode: "fixed", value: "11.60" },
  };
  let income, expense;
  await test("durable concurrent retries create one entry, payment and commission", async () => {
    const request = randomUUID();
    const results = await Promise.all([
      run("movement.create", input, request),
      run("movement.create", input, request),
    ]);
    assert.equal(results[0].id, results[1].id);
    income = results[0];
    await assert.rejects(
      run("movement.create", { ...input, concept: "Changed" }, request),
      /otros datos/,
    );
    const detail = await movementDetail(income.id);
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.movement.total_cents, 11600);
    assert.equal(detail.movement.subtotal_cents, 10000);
    assert.equal(detail.movement.paid_cents, 11600);
    assert.equal(detail.movement.commission_cents, 1160);
    await assert.rejects(
      run("movement.create", { ...input, ticketCode: manualId }),
      /ya está registrado/,
    );
    await assert.rejects(
      run("movement.create", { ...input, ticketCode: "" }),
      /ID de venta/,
    );
  });
  await test("sales require full settlement and never accept later customer installments", async () => {
    const sourceId = await ticket(),
      payload = {
        ...input,
        ticketCode: "LLA1:V:" + sourceId,
        useTicketData: true,
        commission: null,
      };
    const before = (
      await connection.query("SELECT count(*) FROM administracion.movements")
    ).rows[0].count;
    for (const received of ["0", "16.00", "232.01"])
      await assert.rejects(
        run("movement.create", { ...payload, received }),
        /cobro completo/,
      );
    assert.equal(
      (await connection.query("SELECT count(*) FROM administracion.movements"))
        .rows[0].count,
      before,
    );
    await assert.rejects(
      run("payment.create", {
        movementId: income.id,
        date: day,
        method: "efectivo",
        amount: "1.00",
        reference: "",
      }),
      /no admiten abonos posteriores/,
    );
    assert.equal((await movementDetail(income.id)).payments.length, 1);
    await assert.rejects(
      getState(new URLSearchParams({ from: day, to: day, view: "cobros" })),
      /cobro completo/,
    );
    assert.equal("receivable" in (await getState(params)).summary, false);
    const { received: _received, ...withoutReceived } = payload;
    const saved = await run("movement.create", withoutReceived);
    const detail = await movementDetail(saved.id);
    assert.equal(detail.movement.paid_cents, detail.movement.total_cents);
    assert.equal(detail.payments.length, 1);
    await run("movement.void", {
      id: saved.id,
      reason: "Fin de prueba de cobro completo",
    });
  });
  await test("two concurrent supplier payments cannot overpay the outstanding balance", async () => {
    const payableExpense = await run("movement.create", {
      ...input,
      kind: "salida",
      supplierId: supplier.id,
      concept: "Compra concurrente QA",
      category: "Compra de productos",
      commission: null,
      received: "0",
      items: [{ description: "Compra QA", quantity: 1, unitPrice: "100.00" }],
    });
    const results = await Promise.allSettled([
      run("payment.create", {
        movementId: payableExpense.id,
        date: day,
        method: "tarjeta",
        amount: "60.00",
        reference: "",
      }),
      run("payment.create", {
        movementId: payableExpense.id,
        date: day,
        method: "transferencia",
        amount: "60.00",
        reference: "",
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await movementDetail(payableExpense.id)).movement.paid_cents,
      6000,
    );
    await run("movement.void", {
      id: payableExpense.id,
      reason: "Fin de prueba de pagos concurrentes",
    });
  });
  await test("one employee per income and no commission on an expense", async () => {
    await assert.rejects(
      run("commission.create", {
        movementId: income.id,
        commission: input.commission,
      }),
      /al registrar la venta/,
    );
    expense = await run("movement.create", {
      ...input,
      kind: "salida",
      supplierId: supplier.id,
      concept: "Compra QA",
      category: "Compra de productos",
      commission: null,
      received: "20.00",
      items: [{ description: "Compra QA", quantity: 1, unitPrice: "50.00" }],
    });
    await assert.rejects(
      run("commission.create", {
        movementId: expense.id,
        commission: input.commission,
      }),
      /al registrar la venta/,
    );
    await assert.rejects(
      run("payment.create", {
        movementId: expense.id,
        date: day,
        method: "efectivo",
        amount: "31.00",
        reference: "",
      }),
      /supera/,
    );
  });
  await test("income, expense, commissions and cash reconcile without double-counting supplier payments", async () => {
    await run("payment.create", {
      movementId: expense.id,
      date: day,
      method: "transferencia",
      amount: "30.00",
      reference: "Final",
    });
    let state = await getState(params);
    assert.equal(state.summary.income, 11600);
    assert.equal(state.summary.expenses, 5000);
    assert.equal(state.summary.commissions, 1160);
    assert.equal(state.summary.profit, 5440);
    assert.equal(state.summary.collected, 11600);
    assert.equal(state.summary.paid, 5000);
    assert.equal(state.summary.payable, 0);
    assert.equal(state.summary.employeePayable, 1160);
    const commission = (await movementDetail(income.id)).movement.commission_id;
    await run("commission.pay", { id: commission, date: day });
    state = await getState(params);
    assert.equal(state.summary.cash, 5440);
    assert.equal(state.summary.profit, 5440);
    assert.equal(state.summary.employeePayable, 0);
    await assert.rejects(
      run("commission.pay", { id: commission, date: day }),
      /ya está pagada/,
    );
    await assert.rejects(
      run("movement.void", { id: income.id, reason: "QA" }),
      /comisión pagada/,
    );
  });
  await test("inactive employee history survives and new commissions are refused atomically", async () => {
    await run("employee.active", { id: employee.id, active: false });
    const before = (
      await connection.query("SELECT count(*) FROM administracion.movements")
    ).rows[0].count;
    await assert.rejects(
      run("movement.create", {
        ...input,
        ticketCode: "LLA1:V:" + (await ticket()),
      }),
      /empleado activo/,
    );
    assert.equal(
      (await connection.query("SELECT count(*) FROM administracion.movements"))
        .rows[0].count,
      before,
    );
    assert.equal((await getState(params)).commissions.length, 1);
    await run("employee.active", { id: employee.id, active: true });
  });
  const fixtureId = await ticket("blanca");
  let imported;
  await test("barcode import recovers canonical values and refuses tampering and duplicate imports", async () => {
    const [sale] = await lookupSales("LLA1:V:" + fixtureId);
    assert.equal(sale.totalCents, 23200);
    assert.equal(sale.costCents, null);
    imported = await run("movement.create", {
      ...input,
      source: { kind: "ventas", id: fixtureId },
      useTicketData: true,
      received: "232.00",
      total: "0.01",
      items: [],
    });
    const detail = await movementDetail(imported.id);
    assert.equal(detail.movement.total_cents, 23200);
    assert.equal(detail.movement.source_origin, "blanca");
    assert.equal(detail.movement.review_status, "validated");
    await assert.rejects(
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: fixtureId },
      }),
      /ya está registrado/,
    );
    assert.equal(
      (await lookupSales("LLA1:V:" + fixtureId))[0].registeredId,
      imported.id,
    );
  });
  await test("source changes never rewrite manual reports and cancelled tickets cannot receive new collections", async () => {
    await sourceWriter.query(
      "UPDATE public.ventas SET cancelada=true WHERE id=$1",
      [fixtureId],
    );
    let state = await getState(params);
    assert.equal(state.summary.income, 34800);
    assert.equal(state.summary.commissions, 2320);
    assert.equal(state.summary.cancelled, 0);
    await assert.rejects(
      run("payment.create", {
        movementId: imported.id,
        date: day,
        method: "efectivo",
        amount: "1",
        reference: "",
      }),
      /cancelado/,
    );
    await assert.rejects(
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: fixtureId },
      }),
      /cancelado/,
    );
    await run("movement.void", {
      id: imported.id,
      reason: "Anulación manual tras revisar el ticket",
    });
    state = await getState(params);
    assert.equal(state.summary.income, 11600);
    assert.equal(state.summary.commissions, 1160);
  });
  await test("voiding a mistaken expense preserves the audit and its payments", async () => {
    await run("movement.void", {
      id: expense.id,
      reason: "Registro equivocado QA",
    });
    const detail = await movementDetail(expense.id);
    assert.ok(detail.movement.voided_at);
    assert.equal(detail.payments.length, 2);
    const state = await getState(params);
    assert.equal(state.summary.expenses, 0);
    assert.equal(state.summary.paid, 0);
    assert.ok(
      Number(
        (await connection.query("SELECT count(*) FROM administracion.audit"))
          .rows[0].count,
      ) > 10,
    );
  });
  await test("each database identity is checked before its business SQL", async () => {
    const ownOriginal = process.env.ADMIN_DATABASE_ID;
    try {
      process.env.ADMIN_DATABASE_ID = randomUUID();
      await assert.rejects(getState(params), /instancia/);
    } finally {
      process.env.ADMIN_DATABASE_ID = ownOriginal;
    }
    const sourceOriginal = process.env.SHARED_DATABASE_ID;
    try {
      process.env.SHARED_DATABASE_ID = randomUUID();
      await assert.rejects(lookupSales("LLA1:V:" + fixtureId), /instancia/);
    } finally {
      process.env.SHARED_DATABASE_ID = sourceOriginal;
    }
  });
  await test("different administrator requests racing on the same sale ID cannot duplicate it", async () => {
    const id = await ticket();
    const payload = {
      ...input,
      commission: null,
      ticketCode: "LLA1:V:" + id,
      received: "116.00",
    };
    const results = await Promise.allSettled([
      run("movement.create", payload),
      run("movement.create", payload),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rows = await connection.query(
      "SELECT id FROM administracion.movements WHERE source_kind=$1 AND source_id=$2",
      ["ventas", id],
    );
    assert.equal(rows.rows.length, 1);
    await run("movement.void", {
      id: rows.rows[0].id,
      reason: "Fin de prueba de concurrencia",
    });
    await assert.rejects(run("movement.create", payload), /ya está registrado/);
  });
  await test("manual expenses remember a supplier once and outstanding debts span all dates", async () => {
    const payload = {
      ...input,
      kind: "salida",
      commission: null,
      contact: "Proveedor recordado QA",
      concept: "Material QA",
      category: "Gasto operativo",
      received: "0",
      items: [{ description: "Material QA", quantity: 1, unitPrice: "25.00" }],
    };
    const first = await run("movement.create", payload);
    const second = await run("movement.create", {
      ...payload,
      contact: "PROVEEDOR RECORDADO QA",
    });
    const a = await movementDetail(first.id),
      b = await movementDetail(second.id);
    assert.ok(a.movement.supplier_id);
    assert.equal(a.movement.supplier_id, b.movement.supplier_id);
    assert.equal(
      Number(
        (
          await connection.query(
            "SELECT count(*) FROM administracion.suppliers WHERE name_key='proveedor recordado qa'",
          )
        ).rows[0].count,
      ),
      1,
    );
    const state = await getState(
      new URLSearchParams({
        from: "2000-01-01",
        to: "2000-01-02",
        view: "proveedores",
      }),
    );
    assert.equal(state.summary.payable, 5000);
    assert.equal(state.movements.length, 2);
    await run("movement.void", { id: first.id, reason: "Fin QA" });
    await run("movement.void", { id: second.id, reason: "Fin QA" });
  });
  await test("commissions require a manual amount, allow exactly the sale total and reject preferences atomically", async () => {
    await assert.rejects(run("preferences.save", { rate: "7.5" }));
    const before = (
      await connection.query("SELECT count(*) FROM administracion.movements")
    ).rows[0].count;
    for (const commission of [
      { ...input.commission, mode: "percent", value: "10" },
      { ...input.commission, rememberRate: true },
      { ...input.commission, value: "116.01" },
    ])
      await assert.rejects(
        run("movement.create", {
          ...input,
          ticketCode: "LLA1:V:" + (await ticket()),
          commission,
        }),
      );
    assert.equal(
      (await connection.query("SELECT count(*) FROM administracion.movements"))
        .rows[0].count,
      before,
    );
    const saved = await run("movement.create", {
      ...input,
      ticketCode: "LLA1:V:" + (await ticket()),
      commission: { ...input.commission, value: "116.00" },
    });
    const snapshot = (
      await connection.query(
        "SELECT mode,rate_bps,amount_cents FROM administracion.commissions WHERE movement_id=$1",
        [saved.id],
      )
    ).rows[0];
    assert.equal(snapshot.mode, "fixed");
    assert.equal(snapshot.rate_bps, null);
    assert.equal(Number(snapshot.amount_cents), 11600);
  });
  const payEmployee = await run("employee.save", {
    name: "Empleado liquidación QA",
    position: "Técnico",
    phone: "",
  });
  async function payable(date = day) {
    return run("movement.create", {
      ...input,
      ticketCode: "LLA1:V:" + (await ticket()),
      date,
      commission: { ...input.commission, employeeId: payEmployee.id },
    });
  }
  await test("employee and period preview includes only pending commissions in that range", async () => {
    await payable();
    await payable();
    await payable("2001-01-01");
    const voided = await payable("2001-01-02");
    await run("movement.void", {
      id: voided.id,
      reason: "Excluir comisión anulada QA",
    });
    const preview = await payoutPreview(payEmployee.id, "day", day);
    assert.equal(preview.commissions.length, 2);
    assert.equal(preview.totalCents, 2320);
    assert.equal(
      (await payoutPreview(payEmployee.id, "week", "2001-01-03")).commissions
        .length,
      1,
    );
    assert.equal(
      (await payoutPreview(payEmployee.id, "month", "2001-01-31")).totalCents,
      1160,
    );
    assert.equal(
      (await payoutPreview(employee.id, "month", "2001-01-31")).commissions
        .length,
      0,
    );
    const all = await payoutPreview(payEmployee.id, "all", day);
    assert.equal(all.commissions.length, 3);
    assert.equal(all.totalCents, 3480);
    assert.equal(all.from, "2000-01-01");
    assert.equal(all.to, "2100-12-31");
    const payload = {
      employeeId: payEmployee.id,
      period: "day",
      anchor: day,
      paidOn: day,
      commissionIds: preview.commissions.map((c) => c.id),
      expectedTotalCents: preview.totalCents,
    };
    await assert.rejects(
      run("commission.batchPay", { ...payload, employeeId: employee.id }),
      /cambió/,
    );
    await assert.rejects(
      run("commission.batchPay", { ...payload, expectedTotalCents: 1 }),
      /importe cambió/,
    );
    await assert.rejects(
      run("commission.batchPay", { ...payload, paidOn: "2000-01-01" }),
      /anterior/,
    );
    const request = randomUUID();
    const race = await Promise.allSettled([
      run("commission.batchPay", payload, request),
      run("commission.batchPay", payload),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    const first = race[0].status === "fulfilled" ? race[0].value : null;
    if (first)
      assert.deepEqual(
        await run("commission.batchPay", payload, request),
        first,
      );
    assert.equal(
      (await payoutPreview(payEmployee.id, "day", day)).commissions.length,
      0,
    );
    assert.equal(
      (await payoutPreview(payEmployee.id, "all", day)).commissions.length,
      1,
    );
    await assert.rejects(run("commission.batchPay", payload), /ya fue pagada/);
    const payouts = await connection.query(
      "SELECT * FROM administracion.commission_payouts WHERE employee_id=$1",
      [payEmployee.id],
    );
    assert.equal(payouts.rows.length, 1);
    assert.equal(Number(payouts.rows[0].amount_cents), 2320);
    await assert.rejects(
      connection.query(
        "UPDATE administracion.commissions SET paid_on=NULL WHERE id=$1",
        [payload.commissionIds[0]],
      ),
      (e) => e.code === "23514",
    );
  });
  await test("custom settlements honor their range and all-history settlement clears older pending commissions once", async () => {
    await payable("2001-02-01");
    await payable("2001-02-28");
    const outside = await payable("2001-03-01");
    const custom = await payoutPreview(
      payEmployee.id,
      "custom",
      day,
      "2001-02-01",
      "2001-02-28",
    );
    assert.equal(custom.commissions.length, 2);
    assert.equal(custom.totalCents, 2320);
    const payload = {
      employeeId: payEmployee.id,
      period: "custom",
      anchor: day,
      from: "2001-02-01",
      to: "2001-02-28",
      commissionIds: custom.commissions.map((commission) => commission.id),
      expectedTotalCents: custom.totalCents,
    };
    const outsideCommission = (await movementDetail(outside.id)).movement
      .commission_id;
    await assert.rejects(
      run("commission.batchPay", {
        ...payload,
        commissionIds: [outsideCommission],
        expectedTotalCents: 1160,
      }),
      /cambió/,
    );
    await assert.rejects(
      payoutPreview(payEmployee.id, "custom", day, "2001-03-01", "2001-02-28"),
    );
    const request = randomUUID();
    const saved = await run("commission.batchPay", payload, request);
    assert.deepEqual(await run("commission.batchPay", payload, request), saved);
    assert.equal(
      (
        await payoutPreview(
          payEmployee.id,
          "custom",
          day,
          payload.from,
          payload.to,
        )
      ).commissions.length,
      0,
    );
    const all = await payoutPreview(payEmployee.id, "all", day);
    assert.equal(all.commissions.length, 2);
    assert.equal(all.totalCents, 2320);
    const allPayload = {
      employeeId: payEmployee.id,
      period: "all",
      anchor: day,
      commissionIds: all.commissions.map((commission) => commission.id),
      expectedTotalCents: all.totalCents,
    };
    await run("commission.batchPay", allPayload);
    assert.equal(
      (await payoutPreview(payEmployee.id, "all", day)).commissions.length,
      0,
    );
    await assert.rejects(
      run("commission.batchPay", allPayload),
      /ya fue pagada/,
    );
    assert.equal(
      (
        await connection.query(
          "SELECT count(*) FROM administracion.commissions c JOIN administracion.movements m ON m.id=c.movement_id WHERE c.employee_id=$1 AND c.paid_on IS NULL AND m.voided_at IS NOT NULL",
          [payEmployee.id],
        )
      ).rows[0].count,
      "1",
    );
  });
  await test("overlapping settlements are atomic and an inactive employee can collect existing commissions", async () => {
    await payable();
    await payable();
    await payable();
    await run("employee.active", { id: payEmployee.id, active: false });
    const preview = await payoutPreview(payEmployee.id, "day", day),
      ids = preview.commissions.map((c) => c.id);
    const payload = {
      employeeId: payEmployee.id,
      period: "day",
      anchor: day,
      paidOn: day,
      expectedTotalCents: 2320,
    };
    const result = await Promise.allSettled([
      run("commission.batchPay", {
        ...payload,
        commissionIds: ids.slice(0, 2),
      }),
      run("commission.batchPay", {
        ...payload,
        commissionIds: ids.slice(1, 3),
      }),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await payoutPreview(payEmployee.id, "day", day)).commissions.length,
      1,
    );
    await run("employee.active", { id: payEmployee.id, active: true });
  });
  await test("manual fallback records a sale and commission without any sale in the other apps", async () => {
    const offlineId = "offline-" + randomUUID(),
      folio = "PAPEL-" + randomUUID().slice(0, 8);
    const payload = {
      ...input,
      manual: true,
      folio,
      origin: "manual",
      manualTicketCode: "LLA1:V:" + offlineId,
    };
    const saved = await run("movement.create", payload),
      detail = await movementDetail(saved.id);
    assert.equal(detail.movement.source_id, null);
    assert.equal(detail.movement.manual_folio, folio);
    assert.equal(detail.movement.commission_cents, 1160);
    assert.equal(
      (
        await sourceWriter.query("SELECT id FROM public.ventas WHERE id=$1", [
          offlineId,
        ])
      ).rows.length,
      0,
    );
    const frozen = await payoutPreview(employee.id, "day", day);
    assert.equal(
      frozen.commissions.some((c) => c.movement_id === saved.id),
      false,
    );
    assert.ok(frozen.frozenCents >= 1160);
    await approve(saved.id);
    const preview = await payoutPreview(employee.id, "day", day),
      commission = preview.commissions.find((c) => c.movement_id === saved.id);
    assert.ok(commission);
    await run("commission.batchPay", {
      employeeId: employee.id,
      period: "day",
      anchor: day,
      paidOn: day,
      commissionIds: [commission.id],
      expectedTotalCents: 1160,
    });
    await assert.rejects(
      run("movement.create", {
        ...payload,
        folio: " " + folio.toLowerCase() + " ",
      }),
      /ya está registrado/,
    );
    await ticket("negra", { id: offlineId, folio });
    assert.equal(
      (await lookupSales("LLA1:V:" + offlineId))[0].registeredId,
      saved.id,
    );
    await assert.rejects(
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: offlineId },
        useTicketData: true,
      }),
      /ya está registrado/,
    );
  });
  await test("manual folios serialize duplicates, survive voiding and block later scans even without a printed ID", async () => {
    const folio = "CONTINGENCIA-" + randomUUID().slice(0, 8),
      payload = {
        ...input,
        manual: true,
        folio,
        origin: "manual",
        commission: null,
      };
    const race = await Promise.allSettled([
      run("movement.create", payload),
      run("movement.create", { ...payload, folio: folio.toLowerCase() }),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    const saved = race.find((r) => r.status === "fulfilled").value;
    await run("movement.void", {
      id: saved.id,
      reason: "Fin de prueba manual",
    });
    await assert.rejects(run("movement.create", payload), /ya está registrado/);
    const sourceId = await ticket("blanca", { folio });
    assert.equal(
      (await lookupSales("LLA1:V:" + sourceId))[0].registeredId,
      saved.id,
    );
    await assert.rejects(
      run("movement.create", { ...input, ticketCode: "LLA1:V:" + sourceId }),
      /ya está registrado/,
    );
  });
  await test("manual known-origin folios allow distinct systems but reject existing registered canonical folios", async () => {
    const folio = "MISMO-FOLIO-" + randomUUID().slice(0, 8),
      payload = {
        ...input,
        manual: true,
        folio,
        origin: "negra",
        commission: null,
      };
    await run("movement.create", payload);
    await run("movement.create", { ...payload, origin: "blanca" });
    await assert.rejects(
      run("movement.create", { ...payload, origin: "manual" }),
      /ya está registrado/,
    );
    const sourceId = await ticket(),
      [sale] = await lookupSales("LLA1:V:" + sourceId);
    await run("movement.create", {
      ...input,
      ticketCode: "LLA1:V:" + sourceId,
      commission: null,
    });
    await assert.rejects(
      run("movement.create", { ...payload, folio: sale.folio }),
      /ya está registrado/,
    );
    await assert.rejects(
      run("movement.create", {
        ...payload,
        folio: "OTRO-" + folio,
        manualTicketCode: "LLA1:V:" + sourceId,
      }),
      /ya está registrado/,
    );
  });
  await test("a manual entry racing a scan still creates exactly one record for the same ticket", async () => {
    const sourceId = await ticket(),
      [sale] = await lookupSales("LLA1:V:" + sourceId);
    const scanned = {
      ...input,
      ticketCode: "LLA1:V:" + sourceId,
      commission: null,
    };
    const manual = {
      ...input,
      manual: true,
      folio: sale.folio,
      origin: sale.origin,
      manualTicketCode: "LLA1:V:" + sourceId,
      commission: null,
    };
    const result = await Promise.allSettled([
      run("movement.create", manual),
      run("movement.create", scanned),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    const records = await connection.query(
      "SELECT id FROM administracion.movements WHERE source_id=$1 OR manual_ticket_code=$2",
      [sourceId, "LLA1:V:" + sourceId],
    );
    assert.equal(records.rows.length, 1);
  });
  await test("compact manual sale generates its identity/date and retries atomically without hidden client fields", async () => {
    const request = randomUUID(),
      payload = {
        description: "Venta compacta QA",
        quantity: 2,
        unitPrice: "125.50",
        method: "tarjeta",
        contact: "Cliente compacto QA",
        commission: { employeeId: employee.id, mode: "fixed", value: "25.10" },
        folio: "IGNORAR",
        date: "2000-01-01",
        received: "0.01",
        vatIncluded: true,
      };
    const sourceCount = (
      await sourceWriter.query("SELECT count(*) FROM public.ventas")
    ).rows[0].count;
    const results = await Promise.all([
      run("sale.manual.create", payload, request),
      run("sale.manual.create", payload, request),
    ]);
    assert.equal(results[0].id, results[1].id);
    const { movement, payments } = await movementDetail(results[0].id);
    assert.equal(movement.manual_folio, "MAN-" + request);
    assert.equal(movement.date, day);
    assert.equal(movement.source_id, null);
    assert.equal(movement.total_cents, 25100);
    assert.equal(movement.tax_cents, 0);
    assert.equal(movement.paid_cents, 25100);
    assert.equal(movement.commission_cents, 2510);
    assert.equal(payments.length, 1);
    assert.equal(
      (await sourceWriter.query("SELECT count(*) FROM public.ventas")).rows[0]
        .count,
      sourceCount,
    );
    await assert.rejects(
      run("sale.manual.create", { ...payload, unitPrice: "126.00" }, request),
      /otros datos/,
    );
  });
  await test("compact manual sale keeps commission optional and invalid commissions roll back the whole sale", async () => {
    const payload = {
      description: "Servicio compacto QA",
      quantity: 1,
      unitPrice: "100",
      method: "efectivo",
      contact: "",
      commission: null,
    };
    const result = await run("sale.manual.create", payload),
      detail = await movementDetail(result.id);
    assert.equal(detail.movement.contact, "Público general");
    assert.equal(detail.movement.commission_id, null);
    const before = (
      await connection.query("SELECT count(*) FROM administracion.movements")
    ).rows[0].count;
    await assert.rejects(
      run("sale.manual.create", {
        ...payload,
        commission: { employeeId: employee.id, mode: "fixed", value: "101" },
      }),
      /no superar/,
    );
    assert.equal(
      (await connection.query("SELECT count(*) FROM administracion.movements"))
        .rows[0].count,
      before,
    );
    const another = await run("sale.manual.create", payload);
    assert.notEqual(
      another.id,
      result.id,
      "Separate confirmed sales may legitimately have the same contents.",
    );
  });
  async function bulkPayables(employeeId, count) {
    // Bulk fixtures are allowed only in this run's disposable Administration clone.
    assert.equal(
      (await connection.query("SELECT current_database() AS name")).rows[0]
        .name,
      "llantas_admin_tests",
    );
    const fixtures = Array.from({ length: count }, () => ({
      movementId: randomUUID(),
      commissionId: randomUUID(),
    }));
    await connection.query(
      `WITH fixtures AS (
        SELECT * FROM unnest($1::uuid[],$2::uuid[]) AS f(movement_id,commission_id)
      ), inserted AS (
        INSERT INTO administracion.movements
        (id,kind,date,concept,category,contact,items,subtotal_cents,tax_cents,total_cents,method,manual_folio,manual_origin,review_status)
        SELECT movement_id,'entrada','2001-01-01','Comisión histórica QA','Venta manual','Público QA',
          '[{"description":"Servicio QA","quantity":1,"unitCents":1000,"totalCents":1000}]'::jsonb,
          1000,0,1000,'efectivo','QA-BULK-'||movement_id::text,'manual','approved' FROM fixtures
        RETURNING id
      )
      INSERT INTO administracion.commissions(id,movement_id,employee_id,amount_cents,mode)
      SELECT f.commission_id,m.id,$3::uuid,100,'fixed' FROM inserted m JOIN fixtures f ON f.movement_id=m.id`,
      [
        fixtures.map((fixture) => fixture.movementId),
        fixtures.map((fixture) => fixture.commissionId),
        employeeId,
      ],
    );
    return fixtures;
  }
  function snapshotPayload(preview, period = "all", anchor = day) {
    return {
      employeeId: preview.employeeId,
      period,
      anchor,
      snapshot: preview.snapshot,
      expectedTotalCents: preview.totalCents,
    };
  }
  await test("snapshot settlements pay more than 5000 historical commissions with a small request and durable replay", async () => {
    const bulkEmployee = await run("employee.save", {
      name: "Historial completo QA",
      phone: "",
      position: "Técnico",
    });
    await bulkPayables(bulkEmployee.id, 5201);
    const preview = await payoutPreview(bulkEmployee.id, "all", day);
    assert.equal(preview.commissions.length, 5201);
    assert.equal(preview.totalCents, 520100);
    assert.match(preview.snapshot, /^[a-f\d]{64}$/);
    assert.equal(
      (await payoutPreview(bulkEmployee.id, "all", day)).snapshot,
      preview.snapshot,
    );
    assert.notEqual(
      (await payoutPreview(bulkEmployee.id, "day", "2001-01-01")).snapshot,
      preview.snapshot,
    );
    const payload = snapshotPayload(preview);
    assert.ok(
      Buffer.byteLength(JSON.stringify(payload)) < 1000,
      "The request contains a digest, not thousands of commission IDs.",
    );
    assert.ok(
      Buffer.byteLength(
        JSON.stringify(preview.commissions.map((row) => row.id)),
      ) > 100_000,
      "The fixture exceeds the previous HTTP body and legacy ID limits.",
    );
    const request = randomUUID();
    const paid = await run("commission.batchPay", payload, request);
    assert.equal(paid.count, 5201);
    assert.equal(paid.totalCents, 520100);
    assert.deepEqual(await run("commission.batchPay", payload, request), paid);
    await assert.rejects(run("commission.batchPay", payload), /cambiaron/);
    assert.equal(
      (await payoutPreview(bulkEmployee.id, "all", day)).commissions.length,
      0,
    );
    const settlement = (
      await connection.query(
        "SELECT commission_count,amount_cents FROM administracion.commission_payouts WHERE id=$1",
        [paid.id],
      )
    ).rows[0];
    assert.equal(settlement.commission_count, 5201);
    assert.equal(Number(settlement.amount_cents), 520100);
  });
  await test("reviewed snapshots reject new, changed, voided and already paid commissions", async () => {
    const snapshotEmployee = await run("employee.save", {
      name: "Revisión de liquidación QA",
      phone: "",
      position: "Técnico",
    });
    const [first] = await bulkPayables(snapshotEmployee.id, 1);
    let preview = await payoutPreview(snapshotEmployee.id, "all", day);
    await assert.rejects(
      run("commission.batchPay", {
        ...snapshotPayload(preview),
        snapshot: "invalid",
      }),
      /revisar/,
    );
    await assert.rejects(
      run("commission.batchPay", {
        ...snapshotPayload(preview),
        period: "day",
        anchor: "2001-01-01",
      }),
      /cambiaron/,
    );
    const [second] = await bulkPayables(snapshotEmployee.id, 1);
    await assert.rejects(
      run("commission.batchPay", snapshotPayload(preview)),
      /cambiaron/,
    );
    preview = await payoutPreview(snapshotEmployee.id, "all", day);
    await connection.query(
      "UPDATE administracion.commissions SET amount_cents=200 WHERE id=$1",
      [first.commissionId],
    );
    await assert.rejects(
      run("commission.batchPay", snapshotPayload(preview)),
      /cambiaron/,
    );
    preview = await payoutPreview(snapshotEmployee.id, "all", day);
    await run("movement.void", {
      id: first.movementId,
      reason: "Cambio posterior a revisión QA",
    });
    await assert.rejects(
      run("commission.batchPay", snapshotPayload(preview)),
      /cambiaron/,
    );
    preview = await payoutPreview(snapshotEmployee.id, "all", day);
    await run("commission.pay", { id: second.commissionId, date: day });
    await assert.rejects(
      run("commission.batchPay", snapshotPayload(preview)),
      /cambiaron/,
    );
    assert.equal(
      (
        await connection.query(
          "SELECT count(*) FROM administracion.commission_payouts WHERE employee_id=$1",
          [snapshotEmployee.id],
        )
      ).rows[0].count,
      "0",
    );
  });
  await test("concurrent snapshot settlements pay the reviewed history exactly once", async () => {
    const snapshotEmployee = await run("employee.save", {
      name: "Liquidación concurrente QA",
      phone: "",
      position: "Técnico",
    });
    await bulkPayables(snapshotEmployee.id, 2);
    const preview = await payoutPreview(snapshotEmployee.id, "all", day);
    const payload = snapshotPayload(preview);
    const requests = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(
      requests.map((request) => run("commission.batchPay", payload, request)),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const winningIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    const winning = results[winningIndex].value;
    assert.equal(winning.count, 2);
    assert.deepEqual(
      await run("commission.batchPay", payload, requests[winningIndex]),
      winning,
    );
    assert.equal(
      (await payoutPreview(snapshotEmployee.id, "all", day)).commissions.length,
      0,
    );
    assert.equal(
      (
        await connection.query(
          "SELECT count(*) FROM administracion.commission_payouts WHERE employee_id=$1",
          [snapshotEmployee.id],
        )
      ).rows[0].count,
      "1",
    );
  });
  const accountingEmployee = await run("employee.save", {
    name: "Ganancia por periodo QA",
    phone: "",
    position: "Técnico",
  });
  async function accountingMovement(kind, date, amount, extra = {}) {
    const saved = await run("movement.create", {
      kind,
      date,
      manual: kind === "entrada",
      folio: "QA-GANANCIA-" + randomUUID(),
      origin: "manual",
      concept: "Conciliación de ganancia QA",
      category: kind === "entrada" ? "Venta manual" : "Gasto operativo",
      contact:
        kind === "entrada" ? "Cliente contable QA" : "Proveedor contable QA",
      phone: "",
      items: [
        { description: "Importe contable QA", quantity: 1, unitPrice: amount },
      ],
      vatIncluded: true,
      method: "efectivo",
      received: kind === "entrada" ? amount : "0",
      reference: "",
      notes: "",
      commission: null,
      ...extra,
    });
    // These fixtures exercise confirmed accounting; pending captures have separate coverage below.
    if (kind === "entrada") await approve(saved.id);
    return saved;
  }
  async function accountingSummary(from, to = from) {
    const { summary } = await getState(new URLSearchParams({ from, to }));
    return Object.fromEntries(
      [
        "income",
        "expenses",
        "commissions",
        "profit",
        "collected",
        "paid",
        "commissionPaid",
        "cash",
      ].map((key) => [key, summary[key]]),
    );
  }
  const januaryAccounting = {
    income: 100000,
    expenses: 30000,
    commissions: 10000,
    profit: 60000,
    collected: 100000,
    paid: 0,
    commissionPaid: 0,
    cash: 100000,
  };
  let accountingSale, accountingExpense;
  await test("period profit uses complete sale totals minus incurred expenses and commissions, independently of cash and VAT breakdown", async () => {
    assert.equal(
      (
        await getState(
          new URLSearchParams({ from: "2002-01-01", to: "2002-04-30" }),
        )
      ).total,
      0,
      "Accounting dates are isolated from the other disposable fixtures.",
    );
    accountingSale = await accountingMovement(
      "entrada",
      "2002-01-15",
      "1000.00",
      {
        commission: { employeeId: accountingEmployee.id, value: "100.00" },
      },
    );
    accountingExpense = await accountingMovement(
      "salida",
      "2002-01-15",
      "300.00",
    );
    const detail = await movementDetail(accountingSale.id);
    assert.equal(detail.movement.total_cents, 100000);
    assert.equal(detail.movement.subtotal_cents, 86207);
    assert.equal(detail.movement.tax_cents, 13793);
    assert.deepEqual(await accountingSummary("2002-01-15"), januaryAccounting);
    assert.deepEqual(
      await accountingSummary("2002-01-01", "2002-01-31"),
      januaryAccounting,
    );
    assert.deepEqual(
      await accountingSummary("2002-01-01", "2002-01-15"),
      januaryAccounting,
    );
    assert.deepEqual(
      await accountingSummary("2002-01-15", "2002-01-31"),
      januaryAccounting,
    );
    for (const [from, to] of [
      ["2002-01-01", "2002-01-14"],
      ["2002-01-16", "2002-01-31"],
    ])
      assert.deepEqual(await accountingSummary(from, to), {
        income: 0,
        expenses: 0,
        commissions: 0,
        profit: 0,
        collected: 0,
        paid: 0,
        commissionPaid: 0,
        cash: 0,
      });
  });
  await test("later supplier and commission settlements change cash in their payment month without subtracting profit again", async () => {
    await run("payment.create", {
      movementId: accountingExpense.id,
      date: "2002-02-10",
      amount: "300.00",
      method: "transferencia",
      reference: "Gasto de enero pagado en febrero QA",
    });
    const commissionId = (await movementDetail(accountingSale.id)).movement
      .commission_id;
    await run("commission.pay", { id: commissionId, date: "2002-02-10" });
    assert.deepEqual(
      await accountingSummary("2002-01-01", "2002-01-31"),
      januaryAccounting,
    );
    assert.deepEqual(await accountingSummary("2002-02-01", "2002-02-28"), {
      income: 0,
      expenses: 0,
      commissions: 0,
      profit: 0,
      collected: 0,
      paid: 30000,
      commissionPaid: 10000,
      cash: -40000,
    });
    assert.deepEqual(await accountingSummary("2002-01-15", "2002-02-10"), {
      ...januaryAccounting,
      paid: 30000,
      commissionPaid: 10000,
      cash: 60000,
    });
    assert.deepEqual(await accountingSummary("2002-02-10"), {
      income: 0,
      expenses: 0,
      commissions: 0,
      profit: 0,
      collected: 0,
      paid: 30000,
      commissionPaid: 10000,
      cash: -40000,
    });
  });
  await test("a different period stays isolated and losses remain negative even when its expenses are unpaid", async () => {
    await accountingMovement("entrada", "2002-03-15", "200.00");
    await accountingMovement("salida", "2002-03-15", "500.00");
    assert.deepEqual(await accountingSummary("2002-03-01", "2002-03-31"), {
      income: 20000,
      expenses: 50000,
      commissions: 0,
      profit: -30000,
      collected: 20000,
      paid: 0,
      commissionPaid: 0,
      cash: 20000,
    });
    assert.deepEqual(
      await accountingSummary("2002-01-01", "2002-01-31"),
      januaryAccounting,
    );
    assert.equal(
      (await accountingSummary("2002-02-01", "2002-02-28")).profit,
      0,
    );
  });
  await test("voided sales, unpaid commissions and expenses leave the period totals and cash while preserving their records", async () => {
    const sale = await accountingMovement("entrada", "2002-04-01", "100.00", {
      commission: { employeeId: accountingEmployee.id, value: "10.00" },
    });
    const expense = await accountingMovement("salida", "2002-04-01", "40.00", {
      received: "40.00",
    });
    assert.deepEqual(await accountingSummary("2002-04-01", "2002-04-30"), {
      income: 10000,
      expenses: 4000,
      commissions: 1000,
      profit: 5000,
      collected: 10000,
      paid: 4000,
      commissionPaid: 0,
      cash: 6000,
    });
    await run("movement.void", { id: sale.id, reason: "Venta equivocada QA" });
    await run("movement.void", {
      id: expense.id,
      reason: "Gasto equivocado QA",
    });
    assert.deepEqual(await accountingSummary("2002-04-01", "2002-04-30"), {
      income: 0,
      expenses: 0,
      commissions: 0,
      profit: 0,
      collected: 0,
      paid: 0,
      commissionPaid: 0,
      cash: 0,
    });
    const preservedSale = await movementDetail(sale.id),
      preservedExpense = await movementDetail(expense.id);
    assert.ok(preservedSale.movement.voided_at);
    assert.equal(preservedSale.movement.commission_cents, 1000);
    assert.equal(preservedSale.movement.commission_paid_on, null);
    assert.equal(preservedSale.payments.length, 1);
    assert.ok(preservedExpense.movement.voided_at);
    assert.equal(preservedExpense.payments.length, 1);
  });
  const reviewEmployee = await run("employee.save", {
    name: "Revisión de ventas QA",
    phone: "",
    position: "Técnico",
  });
  async function reviewSale(extra = {}) {
    return run("movement.create", {
      ...input,
      manual: true,
      folio: "QA-REVISION-" + randomUUID(),
      origin: "manual",
      date: "2003-01-15",
      commission: {
        employeeId: reviewEmployee.id,
        mode: "fixed",
        value: "11.60",
      },
      ...extra,
    });
  }
  async function validationPayload(id, sourceId, extra = {}) {
    const { movement } = await movementDetail(id);
    const [sale] = await lookupSales("LLA1:V:" + sourceId);
    assert.ok(sale);
    assert.match(sale.fingerprint, /^[a-f\d]{64}$/);
    return {
      id,
      reviewVersion: movement.review_version,
      sourceKind: sale.kind,
      sourceId: sale.id,
      sourceFingerprint: sale.fingerprint,
      ...extra,
    };
  }
  await test("manual sales stay outside confirmed totals and appear separately in their period and the global review queue", async () => {
    const compact = await run("sale.manual.create", {
      description: "Revisión compacta QA",
      quantity: 1,
      unitPrice: "50",
      method: "efectivo",
      contact: "",
      commission: null,
    });
    const saved = await reviewSale();
    for (const id of [saved.id, compact.id]) {
      const { movement } = await movementDetail(id);
      assert.equal(movement.source_id, null);
      assert.equal(movement.review_status, "pending");
      assert.equal(movement.review_version, 1);
    }
    const unrelated = new URLSearchParams({
      from: "2099-01-01",
      to: "2099-01-31",
      view: "revision",
    });
    const queue = await getState(unrelated);
    assert.ok(queue.reviewCount >= 2);
    assert.equal(queue.total, queue.reviewCount);
    assert.ok(queue.movements.some((movement) => movement.id === saved.id));
    assert.ok(
      queue.movements.every((movement) => movement.review_status === "pending"),
    );
    const pending = (
      await connection.query(
        "SELECT count(*),COALESCE(sum(total_cents),0) AS total FROM administracion.manual_ledger WHERE kind='entrada' AND review_status='pending' AND NOT source_cancelled AND voided_at IS NULL",
      )
    ).rows[0];
    assert.equal(queue.reviewCount, Number(pending.count));
    assert.equal(queue.reviewTotal, Number(pending.total));
    assert.equal(queue.summary.pendingIncome, 0);
    assert.equal(queue.summary.pendingCommissions, 0);
    assert.equal(queue.summary.pendingSalesCount, 0);
    const state = await getState(
      new URLSearchParams({ from: "2003-01-15", to: "2003-01-15" }),
    );
    assert.equal(state.summary.income, 0);
    assert.equal(state.summary.commissions, 0);
    assert.equal(state.summary.profit, 0);
    assert.equal(state.summary.pendingIncome, 11600);
    assert.equal(state.summary.pendingCommissions, 1160);
    assert.equal(state.summary.pendingSalesCount, 1);
    assert.equal(state.summary.collected, 11600);
    assert.equal(state.summary.cash, 11600);
    assert.equal(state.reviewTotal, queue.reviewTotal);
    assert.ok(state.summary.employeeFrozen >= 1160);
    await run("movement.void", {
      id: saved.id,
      reason: "Fin de revisión inicial QA",
    });
    const refreshed = await getState(unrelated);
    assert.equal(refreshed.reviewCount, queue.reviewCount - 1);
    assert.equal(refreshed.reviewTotal, queue.reviewTotal - 11600);
    const voided = await getState(
      new URLSearchParams({ from: "2003-01-15", to: "2003-01-15" }),
    );
    assert.equal(voided.summary.pendingIncome, 0);
    assert.equal(voided.summary.pendingCommissions, 0);
    assert.equal(voided.summary.pendingSalesCount, 0);
    assert.equal(
      refreshed.movements.some((movement) => movement.id === saved.id),
      false,
    );
  });
  await test("confirmed sales and active expenses determine profit while pending sales and frozen commissions stay separate", async () => {
    const totalsEmployee = await run("employee.save", {
      name: "Totales confirmados QA",
      phone: "",
      position: "Técnico",
    });
    const date = "2004-01-15";
    const period = new URLSearchParams({ from: date, to: date });
    const before = await getState(period);
    const pending = await reviewSale({
      date,
      commission: { employeeId: totalsEmployee.id, value: "11.60" },
    });
    const confirmed = await reviewSale({
      date,
      items: [
        { description: "Venta aprobada QA", quantity: 1, unitPrice: "300" },
      ],
      received: "300",
      commission: { employeeId: totalsEmployee.id, value: "30" },
    });
    await approve(confirmed.id);
    await accountingMovement("salida", date, "100");
    let state = await getState(period);
    assert.equal(state.summary.income, 30000);
    assert.equal(state.summary.expenses, 10000);
    assert.equal(state.summary.commissions, 3000);
    assert.equal(state.summary.profit, 17000);
    assert.equal(state.summary.pendingIncome, 11600);
    assert.equal(state.summary.pendingCommissions, 1160);
    assert.equal(state.summary.pendingSalesCount, 1);
    assert.equal(state.reviewCount, before.reviewCount + 1);
    assert.equal(state.reviewTotal, before.reviewTotal + 11600);
    assert.equal(
      state.summary.employeePayable,
      before.summary.employeePayable + 3000,
    );
    assert.equal(
      state.summary.employeeFrozen,
      before.summary.employeeFrozen + 1160,
    );
    const payout = await payoutPreview(totalsEmployee.id, "all", day);
    assert.equal(payout.totalCents, 3000);
    assert.equal(payout.commissions.length, 1);
    assert.equal(payout.commissions[0].movement_id, confirmed.id);
    assert.equal(payout.frozenCents, 1160);
    const outside = await getState(
      new URLSearchParams({
        from: "2099-01-01",
        to: "2099-01-31",
        view: "revision",
      }),
    );
    assert.equal(outside.summary.pendingIncome, 0);
    assert.equal(outside.summary.pendingSalesCount, 0);
    assert.equal(outside.reviewTotal, state.reviewTotal);
    assert.equal(outside.reviewCount, state.reviewCount);
    assert.ok(outside.movements.some((movement) => movement.id === pending.id));
    await run("movement.void", {
      id: pending.id,
      reason: "Descartar captura pendiente QA",
    });
    state = await getState(period);
    assert.equal(state.summary.income, 30000);
    assert.equal(state.summary.expenses, 10000);
    assert.equal(state.summary.commissions, 3000);
    assert.equal(state.summary.profit, 17000);
    assert.equal(state.summary.pendingIncome, 0);
    assert.equal(state.summary.pendingCommissions, 0);
    assert.equal(state.summary.pendingSalesCount, 0);
    assert.equal(state.reviewTotal, before.reviewTotal);
    assert.equal(state.reviewCount, before.reviewCount);
    assert.equal(state.summary.employeeFrozen, before.summary.employeeFrozen);
  });
  await test("a pending sale with a full-value commission never creates a loss, and payment does not deduct it twice", async () => {
    const employee = await run("employee.save", {
      name: "Comisión completa por revisar QA",
      phone: "",
      position: "Técnico",
    });
    const date = "2004-02-15";
    const paymentDate = "2004-02-16";
    const period = new URLSearchParams({ from: date, to: date });
    const before = await getState(period);
    const saved = await reviewSale({
      date,
      items: [
        {
          description: "Venta con comisión completa QA",
          quantity: 1,
          unitPrice: "500",
        },
      ],
      received: "500",
      commission: { employeeId: employee.id, value: "500" },
    });
    let state = await getState(period);
    assert.equal(state.summary.income, 0);
    assert.equal(state.summary.expenses, 0);
    assert.equal(state.summary.commissions, 0);
    assert.equal(state.summary.profit, 0);
    assert.equal(state.summary.pendingIncome, 50000);
    assert.equal(state.summary.pendingCommissions, 50000);
    assert.equal(state.summary.pendingSalesCount, 1);
    assert.equal(state.summary.employeePayable, before.summary.employeePayable);
    assert.equal(
      state.summary.employeeFrozen,
      before.summary.employeeFrozen + 50000,
    );
    const frozen = await payoutPreview(employee.id, "all", paymentDate);
    assert.equal(frozen.totalCents, 0);
    assert.equal(frozen.commissions.length, 0);
    assert.equal(frozen.frozenCents, 50000);
    assert.equal(frozen.frozenCount, 1);

    await approve(saved.id);
    state = await getState(period);
    assert.equal(state.summary.income, 50000);
    assert.equal(state.summary.commissions, 50000);
    assert.equal(state.summary.profit, 0);
    assert.equal(state.summary.pendingIncome, 0);
    assert.equal(state.summary.pendingCommissions, 0);
    assert.equal(state.summary.pendingSalesCount, 0);
    assert.equal(
      state.summary.employeePayable,
      before.summary.employeePayable + 50000,
    );
    assert.equal(state.summary.employeeFrozen, before.summary.employeeFrozen);

    const { movement } = await movementDetail(saved.id);
    await run("commission.pay", {
      id: movement.commission_id,
      date: paymentDate,
    });
    state = await getState(period);
    assert.equal(state.summary.income, 50000);
    assert.equal(state.summary.commissions, 50000);
    assert.equal(state.summary.profit, 0);
    assert.equal(state.summary.employeePayable, before.summary.employeePayable);
    assert.equal(state.summary.employeeFrozen, before.summary.employeeFrozen);
    const paymentPeriod = await getState(
      new URLSearchParams({ from: paymentDate, to: paymentDate }),
    );
    assert.equal(paymentPeriod.summary.commissions, 0);
    assert.equal(paymentPeriod.summary.profit, 0);
    assert.equal(paymentPeriod.summary.commissionPaid, 50000);
    const paid = await payoutPreview(employee.id, "all", paymentDate);
    assert.equal(paid.totalCents, 0);
    assert.equal(paid.frozenCents, 0);
    assert.equal(paid.frozenCount, 0);
  });
  await test("frozen commissions cannot be paid individually, by IDs or by a settlement snapshot", async () => {
    const saved = await reviewSale();
    const detail = await movementDetail(saved.id);
    const reviewPeriod = new URLSearchParams({
      from: "2003-01-15",
      to: "2003-01-15",
    });
    const beforeApproval = await getState(reviewPeriod);
    assert.equal(beforeApproval.summary.income, 0);
    assert.equal(beforeApproval.summary.commissions, 0);
    assert.equal(beforeApproval.summary.profit, 0);
    assert.equal(beforeApproval.summary.pendingIncome, 11600);
    assert.equal(beforeApproval.summary.pendingCommissions, 1160);
    assert.equal(beforeApproval.summary.pendingSalesCount, 1);
    const preview = await payoutPreview(reviewEmployee.id, "all", day);
    assert.equal(preview.commissions.length, 0);
    assert.equal(preview.totalCents, 0);
    assert.equal(preview.frozenCents, 1160);
    assert.equal(preview.frozenCount, 1);
    await assert.rejects(
      run("commission.pay", { id: detail.movement.commission_id, date: day }),
      /revisi|congelad|aprobad/i,
    );
    await assert.rejects(
      run("commission.batchPay", {
        employeeId: reviewEmployee.id,
        period: "all",
        anchor: day,
        commissionIds: [detail.movement.commission_id],
        expectedTotalCents: 1160,
      }),
      /revisi|congelad|aprobad/i,
    );
    await assert.rejects(run("commission.batchPay", snapshotPayload(preview)));
    assert.equal(
      (await movementDetail(saved.id)).movement.commission_paid_on,
      null,
    );
    const payload = {
        id: saved.id,
        reviewVersion: detail.movement.review_version,
      },
      request = randomUUID();
    const approved = await run("movement.review.approve", payload, request);
    assert.deepEqual(
      await run("movement.review.approve", payload, request),
      approved,
    );
    await assert.rejects(
      run("movement.review.approve", payload),
      /cambi|revisi|aprobad/i,
    );
    const afterApproval = await getState(reviewPeriod);
    assert.equal(afterApproval.summary.income, 11600);
    assert.equal(afterApproval.summary.commissions, 1160);
    assert.equal(afterApproval.summary.profit, 10440);
    assert.equal(afterApproval.summary.pendingIncome, 0);
    assert.equal(afterApproval.summary.pendingCommissions, 0);
    assert.equal(afterApproval.summary.pendingSalesCount, 0);
    assert.equal(afterApproval.reviewTotal, beforeApproval.reviewTotal - 11600);
    assert.equal(afterApproval.reviewCount, beforeApproval.reviewCount - 1);
    assert.equal(
      afterApproval.summary.employeePayable,
      beforeApproval.summary.employeePayable + 1160,
    );
    assert.equal(
      afterApproval.summary.employeeFrozen,
      beforeApproval.summary.employeeFrozen - 1160,
    );
    assert.equal(afterApproval.summary.cash, beforeApproval.summary.cash);
    const released = await payoutPreview(reviewEmployee.id, "all", day);
    assert.equal(released.commissions.length, 1);
    assert.equal(released.totalCents, 1160);
    assert.equal(released.frozenCount, 0);
    assert.equal(released.frozenCents, 0);
    const approvedDetail = await movementDetail(saved.id);
    assert.equal(approvedDetail.movement.review_status, "approved");
    assert.equal(
      approvedDetail.movement.review_version,
      payload.reviewVersion + 1,
    );
    const approvalAudit = (
      await connection.query(
        "SELECT details FROM administracion.audit WHERE entity_id=$1 AND action='movement.review.approve.changes'",
        [saved.id],
      )
    ).rows;
    assert.equal(approvalAudit.length, 1);
    assert.equal(
      approvalAudit[0].details.before.movement.review_status,
      "pending",
    );
    assert.equal(
      approvalAudit[0].details.after.movement.review_status,
      "approved",
    );
    assert.equal(approvalAudit[0].details.after.commission.paid_on, null);
    const payment = snapshotPayload(released),
      paymentRequest = randomUUID();
    const paid = await run("commission.batchPay", payment, paymentRequest);
    assert.deepEqual(
      await run("commission.batchPay", payment, paymentRequest),
      paid,
    );
    await assert.rejects(
      run("commission.pay", { id: detail.movement.commission_id, date: day }),
      /ya está pagada/,
    );
    const sourceId = await ticket();
    await assert.rejects(
      run(
        "movement.review.validate",
        await validationPayload(saved.id, sourceId),
      ),
      /pagad|historial/i,
    );
    assert.equal((await movementDetail(saved.id)).movement.source_id, null);
  });
  await test("a failed ticket search leaves the manual sale and its frozen commission unchanged", async () => {
    const saved = await reviewSale();
    const before = await movementDetail(saved.id);
    assert.deepEqual(await lookupSales("LLA1:V:no-existe-" + randomUUID()), []);
    const after = await movementDetail(saved.id);
    assert.deepEqual(after, before);
    await assert.rejects(
      run("movement.review.validate", {
        id: saved.id,
        reviewVersion: before.movement.review_version,
        sourceKind: "ventas",
        sourceId: "no-existe-" + randomUUID(),
        sourceFingerprint: "0".repeat(64),
      }),
      /encontr|disponible|existe/i,
    );
    assert.deepEqual(await movementDetail(saved.id), before);
    await run("movement.void", {
      id: saved.id,
      reason: "Fin de búsqueda inexistente QA",
    });
  });
  await test("ticket validation replaces real totals, VAT, items, contact and full payment without losing duplicate aliases", async () => {
    const folio = "QA-ALIAS-" + randomUUID();
    const retiredSourceId = "admin-qa-" + randomUUID();
    const saved = await reviewSale({
      folio,
      manualTicketCode: "LLA1:V:" + retiredSourceId,
    });
    const before = await movementDetail(saved.id);
    const sourceId = await ticket("blanca");
    const oldPeriod = new URLSearchParams({
      from: before.movement.date,
      to: before.movement.date,
    });
    const oldTotals = await getState(oldPeriod);
    const sourceTotals = await getState(params);
    const sourceBefore = (
      await sourceWriter.query("SELECT * FROM public.ventas WHERE id=$1", [
        sourceId,
      ])
    ).rows[0];
    const payload = await validationPayload(saved.id, sourceId),
      request = randomUUID();
    const validated = await run("movement.review.validate", payload, request);
    assert.deepEqual(
      await run("movement.review.validate", payload, request),
      validated,
    );
    const detail = await movementDetail(saved.id);
    assert.equal(detail.movement.review_status, "validated");
    assert.equal(detail.movement.review_version, payload.reviewVersion + 1);
    assert.equal(detail.movement.source_kind, "ventas");
    assert.equal(detail.movement.source_id, sourceId);
    assert.equal(detail.movement.source_origin, "blanca");
    assert.equal(detail.movement.date, day);
    assert.equal(detail.movement.contact, "Cliente ticket QA");
    assert.equal(detail.movement.method, "efectivo");
    assert.equal(detail.movement.subtotal_cents, 20000);
    assert.equal(detail.movement.tax_cents, 3200);
    assert.equal(detail.movement.total_cents, 23200);
    assert.equal(detail.movement.paid_cents, 23200);
    assert.equal(detail.movement.items.length, 1);
    assert.equal(
      detail.movement.items[0].description,
      "Servicio de integración",
    );
    assert.equal(detail.movement.items[0].unitCents, 23200);
    assert.equal(detail.movement.items[0].totalCents, 23200);
    assert.equal(
      detail.movement.commission_cents,
      before.movement.commission_cents,
    );
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.payments[0].id, before.payments[0].id);
    assert.equal(detail.payments[0].amount_cents, 23200);
    const oldAfter = await getState(oldPeriod);
    const sourceAfter = await getState(params);
    assert.equal(oldAfter.summary.income, oldTotals.summary.income);
    assert.equal(oldAfter.summary.commissions, oldTotals.summary.commissions);
    assert.equal(oldAfter.summary.profit, oldTotals.summary.profit);
    assert.equal(
      oldAfter.summary.pendingIncome,
      oldTotals.summary.pendingIncome - 11600,
    );
    assert.equal(
      oldAfter.summary.pendingCommissions,
      oldTotals.summary.pendingCommissions - 1160,
    );
    assert.equal(
      oldAfter.summary.pendingSalesCount,
      oldTotals.summary.pendingSalesCount - 1,
    );
    assert.equal(
      sourceAfter.summary.income,
      sourceTotals.summary.income + 23200,
    );
    assert.equal(
      sourceAfter.summary.commissions,
      sourceTotals.summary.commissions + 1160,
    );
    assert.equal(
      sourceAfter.summary.profit,
      sourceTotals.summary.profit + 22040,
    );
    assert.equal(sourceAfter.reviewTotal, sourceTotals.reviewTotal - 11600);
    assert.equal(sourceAfter.reviewCount, sourceTotals.reviewCount - 1);
    assert.equal(
      sourceAfter.summary.employeePayable,
      sourceTotals.summary.employeePayable + 1160,
    );
    assert.equal(
      sourceAfter.summary.employeeFrozen,
      sourceTotals.summary.employeeFrozen - 1160,
    );
    assert.deepEqual(
      (
        await sourceWriter.query("SELECT * FROM public.ventas WHERE id=$1", [
          sourceId,
        ])
      ).rows[0],
      sourceBefore,
    );
    const changes = (
      await connection.query(
        "SELECT details FROM administracion.audit WHERE entity_id=$1 AND action='movement.review.validate.changes'",
        [saved.id],
      )
    ).rows;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].details.before.movement.manual_folio, folio);
    assert.equal(Number(changes[0].details.before.movement.total_cents), 11600);
    assert.equal(Number(changes[0].details.after.movement.total_cents), 23200);
    assert.equal(
      changes[0].details.before.payments[0].id,
      changes[0].details.after.payments[0].id,
    );
    assert.equal(
      (await lookupSales("LLA1:V:" + sourceId))[0].registeredId,
      saved.id,
    );
    await assert.rejects(
      run("movement.review.validate", payload),
      /cambi|valid|revisi/i,
    );
    await assert.rejects(
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: sourceId },
        useTicketData: true,
        received: "232.00",
      }),
      /ya está registrado/,
    );
    await assert.rejects(reviewSale({ folio }), /ya está registrado/);
    await ticket("negra", { id: retiredSourceId });
    assert.equal(
      (await lookupSales("LLA1:V:" + retiredSourceId))[0].registeredId,
      saved.id,
    );
    await assert.rejects(
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: retiredSourceId },
        useTicketData: true,
        received: "232.00",
      }),
      /ya está registrado/,
    );
    await assert.rejects(
      run("movement.review.approve", {
        id: saved.id,
        reviewVersion: detail.movement.review_version,
      }),
      /valid|revisi|aprobad/i,
    );
  });
  await test("changed, cancelled or already registered source tickets are rejected atomically during review", async () => {
    const saved = await reviewSale();
    const sourceId = await ticket();
    const payload = await validationPayload(saved.id, sourceId);
    const before = await movementDetail(saved.id);
    await sourceWriter.query(
      "UPDATE public.ventas SET cliente=$2::jsonb WHERE id=$1",
      [sourceId, JSON.stringify({ nombre: "Cliente cambió QA" })],
    );
    await assert.rejects(
      run("movement.review.validate", payload),
      /cambi|revis/i,
    );
    assert.deepEqual(await movementDetail(saved.id), before);
    const changed = await validationPayload(saved.id, sourceId);
    assert.notEqual(changed.sourceFingerprint, payload.sourceFingerprint);
    await sourceWriter.query(
      "UPDATE public.ventas SET cancelada=true WHERE id=$1",
      [sourceId],
    );
    await assert.rejects(
      run(
        "movement.review.validate",
        await validationPayload(saved.id, sourceId),
      ),
      /cancelad/i,
    );
    assert.deepEqual(await movementDetail(saved.id), before);
    const registeredId = await ticket();
    await run("movement.create", {
      ...input,
      source: { kind: "ventas", id: registeredId },
      useTicketData: true,
      received: "232.00",
      commission: null,
    });
    await assert.rejects(
      run(
        "movement.review.validate",
        await validationPayload(saved.id, registeredId),
      ),
      /ya está registrado/,
    );
    assert.deepEqual(await movementDetail(saved.id), before);
    await run("movement.void", {
      id: saved.id,
      reason: "Fin de validaciones atómicas QA",
    });
  });
  await test("a commission above the real ticket total needs an explicit valid correction before validation", async () => {
    const saved = await reviewSale({
      items: [
        {
          description: "Captura por confirmar QA",
          quantity: 1,
          unitPrice: "500.00",
        },
      ],
      received: "500.00",
      commission: {
        employeeId: reviewEmployee.id,
        mode: "fixed",
        value: "300.00",
      },
    });
    const sourceId = await ticket(),
      payload = await validationPayload(saved.id, sourceId);
    const before = await movementDetail(saved.id);
    for (const extra of [
      {},
      { commissionValue: "232.01" },
      { commissionValue: "0" },
    ]) {
      await assert.rejects(
        run("movement.review.validate", { ...payload, ...extra }),
        /comisi|importe|mayor|super/i,
      );
      assert.deepEqual(await movementDetail(saved.id), before);
    }
    await run("movement.review.validate", {
      ...payload,
      commissionValue: "23.20",
    });
    const detail = await movementDetail(saved.id);
    assert.equal(detail.movement.total_cents, 23200);
    assert.equal(detail.movement.commission_cents, 2320);
    assert.equal(detail.movement.employee_id, reviewEmployee.id);
    assert.equal(detail.movement.review_status, "validated");
  });
  await test("concurrent approval and ticket validation accept only one reviewed version and never pay twice", async () => {
    const saved = await reviewSale();
    const sourceId = await ticket(),
      validation = await validationPayload(saved.id, sourceId);
    const results = await Promise.allSettled([
      run("movement.review.approve", {
        id: saved.id,
        reviewVersion: validation.reviewVersion,
      }),
      run("movement.review.validate", validation),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const { movement } = await movementDetail(saved.id);
    assert.equal(movement.review_version, validation.reviewVersion + 1);
    assert.ok(["approved", "validated"].includes(movement.review_status));
    assert.equal(
      movement.total_cents,
      movement.review_status === "validated" ? 23200 : 11600,
    );
    const payouts = await Promise.allSettled([
      run("commission.pay", { id: movement.commission_id, date: day }),
      run("commission.pay", { id: movement.commission_id, date: day }),
    ]);
    assert.equal(
      payouts.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const after = await movementDetail(saved.id);
    assert.equal(after.movement.commission_paid_on, day);
    assert.equal(after.payments.length, 1);
    await assert.rejects(
      run(
        "movement.review.validate",
        await validationPayload(saved.id, sourceId),
      ),
      /pagad|historial|valid|revisi/i,
    );
    assert.deepEqual(await movementDetail(saved.id), after);
  });
  await test("approval invalidates an earlier payout snapshot and a simultaneous payout cannot bypass a frozen sale", async () => {
    const raceEmployee = await run("employee.save", {
      name: "Carrera aprobación QA",
      phone: "",
      position: "Técnico",
    });
    const saved = await reviewSale({
      commission: { employeeId: raceEmployee.id, value: "11.60" },
    });
    const { movement } = await movementDetail(saved.id);
    const frozen = await payoutPreview(raceEmployee.id, "all", day);
    assert.equal(frozen.totalCents, 0);
    const race = await Promise.allSettled([
      run("movement.review.approve", {
        id: saved.id,
        reviewVersion: movement.review_version,
      }),
      run("commission.pay", { id: movement.commission_id, date: day }),
    ]);
    assert.equal(race[0].status, "fulfilled");
    const after = await movementDetail(saved.id);
    assert.equal(after.movement.review_status, "approved");
    if (race[1].status === "fulfilled") {
      assert.equal(after.movement.commission_paid_on, day);
      await assert.rejects(
        run("commission.pay", { id: movement.commission_id, date: day }),
        /ya está pagada/,
      );
    } else {
      assert.equal(after.movement.commission_paid_on, null);
      const released = await payoutPreview(raceEmployee.id, "all", day);
      assert.equal(released.totalCents, 1160);
      assert.notEqual(released.snapshot, frozen.snapshot);
      await assert.rejects(
        run("commission.batchPay", {
          ...snapshotPayload(frozen),
          expectedTotalCents: 1160,
        }),
        /cambi|revis/i,
      );
      await run("commission.batchPay", snapshotPayload(released));
    }
  });
  await test("reconciling a manual sale against a simultaneous scan preserves one source identity without a database deadlock", async () => {
    const saved = await reviewSale();
    const sourceId = await ticket(),
      payload = await validationPayload(saved.id, sourceId);
    const results = await Promise.allSettled([
      run("movement.review.validate", payload),
      run("movement.create", {
        ...input,
        source: { kind: "ventas", id: sourceId },
        useTicketData: true,
        received: "232.00",
        commission: { employeeId: reviewEmployee.id, value: "11.60" },
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    for (const result of results) {
      if (result.status === "rejected") {
        assert.notEqual(result.reason.code, "40P01");
        assert.match(result.reason.message, /registrad|cambi/i);
      }
    }
    const canonical = await connection.query(
      "SELECT id FROM administracion.movements WHERE source_kind='ventas' AND source_id=$1",
      [sourceId],
    );
    assert.equal(canonical.rows.length, 1);
    const detail = await movementDetail(canonical.rows[0].id);
    assert.equal(detail.movement.review_status, "validated");
    assert.equal(detail.movement.commission_cents, 1160);
    assert.equal(detail.movement.commission_paid_on, null);
    if (canonical.rows[0].id !== saved.id)
      assert.equal(
        (await movementDetail(saved.id)).movement.review_status,
        "pending",
      );
  });
  await test("review migration replay preserves approved historical payouts and never reopens a paid commission", async () => {
    const saved = await reviewSale();
    const { movement } = await movementDetail(saved.id);
    // This clone-only fixture represents a manual commission paid before review existed.
    await connection.query(
      "UPDATE administracion.commissions SET paid_on=$2 WHERE id=$1",
      [movement.commission_id, day],
    );
    const sourceId = await ticket();
    await assert.rejects(
      run(
        "movement.review.validate",
        await validationPayload(saved.id, sourceId),
      ),
      /pagad|historial/i,
    );
    await approve(saved.id);
    const before = await movementDetail(saved.id);
    assert.equal(before.movement.review_status, "approved");
    assert.equal(before.movement.commission_paid_on, day);
    await migrator.query(
      await fs.readFile(
        new URL("../database/007-sale-review.sql", import.meta.url),
        "utf8",
      ),
    );
    await migrator.query(
      `GRANT SELECT ON administracion.manual_ledger TO "${writerRole}"`,
    );
    assert.deepEqual(await movementDetail(saved.id), before);
    await assert.rejects(
      run("commission.pay", { id: movement.commission_id, date: day }),
      /ya está pagada/,
    );
  });
  if (process.argv.includes("--keep")) {
    await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
    await fs.writeFile(
      new URL("../.local/test.env", import.meta.url),
      [
        "DATABASE_URL=" + JSON.stringify(target.toString()),
        "ADMIN_DATABASE_ENVIRONMENT=development",
        "ADMIN_DATABASE_ID=" + process.env.ADMIN_DATABASE_ID,
        "SHARED_DATABASE_URL=" + JSON.stringify(sourceTarget.toString()),
        "SHARED_DATABASE_MODE=true",
        "SHARED_DATABASE_ENVIRONMENT=development",
        "SHARED_DATABASE_ID=" + process.env.SHARED_DATABASE_ID,
        "DB_REQUIRE_SSL=false",
        "SHARED_DB_REQUIRE_SSL=false",
      ].join("\n"),
    );
    console.log(
      "Disposable administration and read-only source QA clones retained. Private launch environment: .local/test.env",
    );
    created = false;
    sourceCreated = false;
  }
  console.log("All administration PostgreSQL integration checks passed.");
} finally {
  await global._adminDatabase?.pool.end();
  await global._sharedDatabase?.pool.end();
  await connection?.end();
  await migrator?.end();
  await sourceWriter?.end();
  if (created) await owner.query("DROP DATABASE llantas_admin_tests");
  if (sourceCreated)
    await owner.query("DROP DATABASE llantas_admin_source_tests");
  await owner.end();
}
