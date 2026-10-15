import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const source = new URL(process.env.DATABASE_URL || "postgresql://invalid");
assert.equal(source.hostname, "127.0.0.1");
assert.equal(source.port, "55439");
assert.equal(source.pathname, "/llantas_unified_dev");
assert.equal(process.env.SHARED_DATABASE_ENVIRONMENT, "development");
const database = "llantas_admin_tests";
const maintenanceUrl = new URL(source);
maintenanceUrl.pathname = "/postgres";
const owner = new pg.Client({ connectionString: maintenanceUrl.toString() });
let created = false,
  connection;
async function test(name, operation) {
  await operation();
  console.log("PASS " + name);
}
try {
  await owner.connect();
  const existing = await owner.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [database],
  );
  assert.equal(
    existing.rows.length,
    0,
    "A test database already exists. Inspect it; never overwrite an unknown database.",
  );
  // No test writes go to the development base. The entire disposable clone is owned by this run.
  await owner.query(
    "CREATE DATABASE llantas_admin_tests TEMPLATE llantas_unified_dev",
  );
  created = true;
  const target = new URL(source);
  target.pathname = "/" + database;
  process.env.DATABASE_URL = target.toString();
  connection = new pg.Client({ connectionString: target.toString() });
  await connection.connect();
  const identity = await connection.query(
    "SELECT environment,instance_id FROM shared_runtime.configuration",
  );
  assert.equal(identity.rows[0].environment, "development");
  assert.equal(identity.rows[0].instance_id, process.env.SHARED_DATABASE_ID);
  for (const name of ["001-administration.sql", "002-manual-registration.sql", "003-commission-settlements.sql"])
    await connection.query(
      await fs.readFile(
        new URL("../database/" + name, import.meta.url),
        "utf8",
      ),
    );
  const { mutate, getState, lookupSales, movementDetail, payoutPreview } = await import(
    "../lib/data.ts"
  );
  const { businessToday } = await import("../lib/domain.ts");
  const day = businessToday(),
    params = new URLSearchParams({ from: day, to: day });
  const run = (action, payload, id = randomUUID()) =>
    mutate(action, payload, id);
  const service = (
    await connection.query("SELECT id,nombre FROM servicios LIMIT 1")
  ).rows[0];
  assert.ok(service);
  async function ticket(origin = "negra") {
    const id = "admin-qa-" + randomUUID();
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
    await connection.query(
      `INSERT INTO public.ventas(id,folio,cliente,items,subtotal,iva,total,"metodoPago","fechaVenta",origen_app,garantia)
      VALUES($1,$2,$3::jsonb,$4::jsonb,200,32,232,'efectivo',now(),$5,$6::jsonb)`,
      [
        id,
        "QA-" + randomUUID().slice(0, 8),
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
    received: "16.00",
    notes: "",
    reference: "",
    commission: { employeeId: employee.id, mode: "percent", value: "10" },
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
  await test("two concurrent payments cannot overcollect the outstanding balance", async () => {
    const results = await Promise.allSettled([
      run("payment.create", {
        movementId: income.id,
        date: day,
        method: "tarjeta",
        amount: "60.00",
        reference: "",
      }),
      run("payment.create", {
        movementId: income.id,
        date: day,
        method: "transferencia",
        amount: "60.00",
        reference: "",
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await movementDetail(income.id)).movement.paid_cents, 7600);
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
    assert.equal(state.summary.collected, 7600);
    assert.equal(state.summary.paid, 5000);
    assert.equal(state.summary.receivable, 4000);
    assert.equal(state.summary.payable, 0);
    assert.equal(state.summary.employeePayable, 1160);
    const commission = (await movementDetail(income.id)).movement.commission_id;
    await run("commission.pay", { id: commission, date: day });
    state = await getState(params);
    assert.equal(state.summary.cash, 1440);
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
      received: "0",
      total: "0.01",
      items: [],
    });
    const detail = await movementDetail(imported.id);
    assert.equal(detail.movement.total_cents, 23200);
    assert.equal(detail.movement.source_origin, "blanca");
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
    await connection.query(
      "UPDATE public.ventas SET cancelada=true WHERE id=$1",
      [fixtureId],
    );
    let state = await getState(params);
    assert.equal(state.summary.income, 34800);
    assert.equal(state.summary.commissions, 3480);
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
  await test("identity mismatch is rejected before business SQL", async () => {
    const original = process.env.SHARED_DATABASE_ID;
    process.env.SHARED_DATABASE_ID = randomUUID();
    await assert.rejects(getState(params), /instancia/);
    process.env.SHARED_DATABASE_ID = original;
  });
  await test("different administrator requests racing on the same sale ID cannot duplicate it", async () => {
    const id = await ticket();
    const payload = {
      ...input,
      commission: null,
      ticketCode: "LLA1:V:" + id,
      received: "0",
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
  await test("commission preference persists only with a successful sale and snapshots the chosen rate", async () => {
    await run("preferences.save", {rate:"7.5"});
    assert.equal((await getState(params)).commissionRateBps,750);
    await assert.rejects(run("preferences.save",{rate:"101"}),/100%/);
    await assert.rejects(run("movement.create",{...input,ticketCode:"LLA1:V:"+await ticket(),commission:{employeeId:randomUUID(),mode:"percent",value:"12",rememberRate:true}}),/empleado activo/);
    assert.equal((await getState(params)).commissionRateBps,750);
    const saved = await run("movement.create",{...input,ticketCode:"LLA1:V:"+await ticket(),commission:{...input.commission,value:"12",rememberRate:true}});
    assert.equal((await getState(params)).commissionRateBps,1200);
    const snapshot = (await connection.query("SELECT mode,rate_bps FROM administracion.commissions WHERE movement_id=$1",[saved.id])).rows[0];
    assert.deepEqual(snapshot,{mode:"percent",rate_bps:1200});
  });
  const payEmployee = await run("employee.save",{name:"Empleado liquidación QA",position:"Técnico",phone:""});
  async function payable(date=day) {
    return run("movement.create",{...input,ticketCode:"LLA1:V:"+await ticket(),date,commission:{...input.commission,employeeId:payEmployee.id}});
  }
  await test("employee and period preview includes only pending commissions in that range", async () => {
    await payable();await payable();await payable("2001-01-01");
    const preview = await payoutPreview(payEmployee.id,"day",day);
    assert.equal(preview.commissions.length,2);
    assert.equal(preview.totalCents,2320);
    assert.equal((await payoutPreview(payEmployee.id,"week","2001-01-03")).commissions.length,1);
    assert.equal((await payoutPreview(payEmployee.id,"month","2001-01-31")).totalCents,1160);
    assert.equal((await payoutPreview(employee.id,"month","2001-01-31")).commissions.length,0);
    const payload={employeeId:payEmployee.id,period:"day",anchor:day,paidOn:day,commissionIds:preview.commissions.map(c=>c.id),expectedTotalCents:preview.totalCents};
    await assert.rejects(run("commission.batchPay",{...payload,employeeId:employee.id}),/cambió/);
    await assert.rejects(run("commission.batchPay",{...payload,expectedTotalCents:1}),/importe cambió/);
    await assert.rejects(run("commission.batchPay",{...payload,paidOn:"2000-01-01"}),/anterior/);
    const request=randomUUID();
    const race=await Promise.allSettled([run("commission.batchPay",payload,request),run("commission.batchPay",payload)]);
    assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
    const first=race[0].status==="fulfilled" ? race[0].value : null;
    if(first) assert.deepEqual(await run("commission.batchPay",payload,request),first);
    assert.equal((await payoutPreview(payEmployee.id,"day",day)).commissions.length,0);
    await assert.rejects(run("commission.batchPay",payload),/ya fue pagada/);
    const payouts=await connection.query("SELECT * FROM administracion.commission_payouts WHERE employee_id=$1",[payEmployee.id]);
    assert.equal(payouts.rows.length,1);assert.equal(Number(payouts.rows[0].amount_cents),2320);
    await assert.rejects(connection.query("UPDATE administracion.commissions SET paid_on=NULL WHERE id=$1",[payload.commissionIds[0]]),e=>e.code==="23514");
  });
  await test("overlapping settlements are atomic and an inactive employee can collect existing commissions", async () => {
    await payable();await payable();await payable();
    await run("employee.active",{id:payEmployee.id,active:false});
    const preview=await payoutPreview(payEmployee.id,"day",day), ids=preview.commissions.map(c=>c.id);
    const payload={employeeId:payEmployee.id,period:"day",anchor:day,paidOn:day,expectedTotalCents:2320};
    const result=await Promise.allSettled([run("commission.batchPay",{...payload,commissionIds:ids.slice(0,2)}),run("commission.batchPay",{...payload,commissionIds:ids.slice(1,3)})]);
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await payoutPreview(payEmployee.id,"day",day)).commissions.length,1);
    await run("employee.active",{id:payEmployee.id,active:true});
  });
  if (process.argv.includes("--keep")) {
    await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
    await fs.writeFile(
      new URL("../.local/test.env", import.meta.url),
      [
        "DATABASE_URL=" + JSON.stringify(target.toString()),
        "SHARED_DATABASE_MODE=true",
        "SHARED_DATABASE_ENVIRONMENT=development",
        "SHARED_DATABASE_ID=" + process.env.SHARED_DATABASE_ID,
        "DB_REQUIRE_SSL=false",
      ].join("\n"),
    );
    console.log(
      "Disposable QA clone retained. Private launch environment: .local/test.env",
    );
    created = false;
  }
  console.log("All administration PostgreSQL integration checks passed.");
} finally {
  await global._adminDatabase?.pool.end();
  await connection?.end();
  if (created) await owner.query("DROP DATABASE llantas_admin_tests");
  await owner.end();
}
