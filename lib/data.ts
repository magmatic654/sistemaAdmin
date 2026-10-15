import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryShared, transaction } from "./db.ts";
import { scanValue } from "./scanner.ts";
import {
  ValidationError,
  text,
  uuid,
  method,
  date,
  cents,
  manualLines,
  commissionAmount,
  parseTicketReference,
  periodRange,
  ticketReference,
  businessToday,
  type RecordInput,
  type Line,
} from "./domain.ts";
import type {
  AdminState,
  Movement,
  Sale,
  Payment,
  CommissionRow,
  Employee,
  Supplier,
  PayoutPreview,
} from "./types.ts";

const SALE_UNION = `SELECT 'ventas' AS kind,id,folio,origen_app AS origin,"fechaVenta" AS sold_at,
  cliente->>'nombre' AS contact,cliente->>'telefono' AS phone,"metodoPago" AS method,
  items,subtotal,iva,total,COALESCE(cancelada,false) AS cancelled FROM public.ventas
 UNION ALL SELECT 'ventas_productos',id,folio,origen_app,fecha,cliente,'' AS phone,"metodoPago",items,subtotal,iva,total,false FROM public.ventas_productos`;

function record(value: unknown): RecordInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("Solicitud inválida.");
  return value as RecordInput;
}
function storedCents(value: unknown): number {
  return cents(String(value), "Importe del ticket", true);
}
function saleRow(row: RecordInput): Sale {
  const items = (row.items as RecordInput[]).map((item) => {
    const snapshot = item.llantaSnapshot as RecordInput | undefined;
    const description = snapshot
      ? [snapshot.marca, snapshot.modelo, snapshot.medida]
          .filter(Boolean)
          .join(" ")
      : String(item.nombre || item.servicioNombre || "Producto o servicio");
    return {
      description,
      quantity: Number(item.cantidad),
      unitCents: storedCents(item.precioUnitario),
      totalCents:
        item.subtotal == null
          ? storedCents(item.precioUnitario) * Number(item.cantidad)
          : storedCents(item.subtotal),
    };
  });
  let costCents: number | null = 0;
  for (const item of row.items as RecordInput[]) {
    if (item.costoUnitario == null || item.costoSubtotal == null) {
      costCents = null;
      break;
    }
    costCents += storedCents(item.costoSubtotal);
  }
  return {
    kind: String(row.kind),
    id: String(row.id),
    folio: String(row.folio),
    origin: String(row.origin),
    date: String(row.business_date),
    contact: String(row.contact || "Público general"),
    phone: String(row.phone || ""),
    method: ["efectivo", "tarjeta", "transferencia", "otro"].includes(
      String(row.method),
    )
      ? String(row.method)
      : "otro",
    subtotalCents: storedCents(row.subtotal),
    taxCents: storedCents(row.iva),
    totalCents: storedCents(row.total),
    costCents,
    items,
    cancelled: Boolean(row.cancelled),
    registeredId: row.registered_id as string | null,
  };
}

export async function lookupSales(
  code: string,
  client?: PoolClient,
): Promise<Sale[]> {
  const needle = scanValue(text(code, "Código o folio", 110));
  const ref = parseTicketReference(needle);
  const values = ref ? [ref.kind, ref.id] : [needle];
  const sql = `SELECT s.*, (s.sold_at AT TIME ZONE 'America/Mexico_City')::date::text AS business_date
    FROM (${SALE_UNION}) s
    WHERE ${ref ? "s.kind=$1 AND s.id=$2" : "(s.folio=$1 OR s.id=$1)"} ORDER BY s.sold_at DESC LIMIT 20`;
  const result = await queryShared(sql, values);
  const sales: Sale[] = [];
  for (const row of result.rows) {
    const registrationSql = `SELECT id FROM administracion.movements WHERE
      (source_kind=$1 AND source_id=$2) OR manual_ticket_code=$3 OR
      (lower(btrim(manual_folio))=lower(btrim($4)) AND manual_origin IN ('manual',$5))
      ORDER BY created_at LIMIT 1`;
    const params = [
      row.kind,
      row.id,
      ticketReference(row.kind, row.id),
      row.folio,
      row.origin,
    ];
    const registered = client
      ? await client.query(registrationSql, params)
      : await query(registrationSql, params);
    sales.push(
      saleRow({ ...row, registered_id: registered.rows[0]?.id || null }),
    );
  }
  return sales;
}

const numericFields = [
  "subtotal_cents",
  "tax_cents",
  "total_cents",
  "paid_cents",
  "cost_cents",
  "commission_cents",
] as const;
function movementRow(row: RecordInput): Movement {
  for (const key of numericFields)
    if (row[key] != null) row[key] = Number(row[key]);
  return row as Movement;
}

export async function getState(params: URLSearchParams): Promise<AdminState> {
  const from = date(params.get("from")),
    to = date(params.get("to"));
  if (from > to)
    throw new ValidationError(
      "La fecha inicial no puede ser posterior a la final.",
    );
  const search = (params.get("q") || "").trim().slice(0, 160);
  const view = params.get("view") || "resumen";
  if (view === "cobros")
    throw new ValidationError("Las ventas se registran con cobro completo.");
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  if (!Number.isInteger(page)) throw new ValidationError("Página inválida.");
  const pageSize = 25;
  const values: unknown[] = [from, to];
  let condition = "l.date BETWEEN $1::date AND $2::date";
  if (view === "entradas") condition += " AND l.kind='entrada'";
  if (view === "salidas") condition += " AND l.kind='salida'";
  if (view === "proveedores") {
    condition =
      "l.kind='salida' AND l.total_cents>l.paid_cents AND NOT l.source_cancelled AND l.voided_at IS NULL AND $1::date<=$2::date";
  }
  if (search) {
    values.push("%" + search.replace(/[\\%_]/g, "\\$&") + "%");
    condition += ` AND concat_ws(' ',l.concept,l.contact,l.source_folio,l.manual_folio,l.reference,l.employee_name) ILIKE $${values.length}`;
  }
  const [
    totals,
    cash,
    pending,
    movements,
    count,
    employees,
    suppliers,
    commissions,
  ] = await Promise.all([
    query(
      `SELECT
      COALESCE(sum(total_cents) FILTER(WHERE kind='entrada' AND NOT source_cancelled AND voided_at IS NULL),0) AS income,
      COALESCE(sum(total_cents) FILTER(WHERE kind='salida' AND voided_at IS NULL),0) AS expenses,
      COALESCE(sum(commission_cents) FILTER(WHERE NOT source_cancelled AND voided_at IS NULL),0) AS commissions,
      count(*) FILTER(WHERE source_cancelled AND voided_at IS NULL) AS cancelled
      FROM administracion.manual_ledger WHERE date BETWEEN $1::date AND $2::date`,
      [from, to],
    ),
    query(
      `SELECT
      COALESCE(sum(p.amount_cents) FILTER(WHERE m.kind='entrada'),0) AS collected,
      COALESCE(sum(p.amount_cents) FILTER(WHERE m.kind='salida'),0) AS paid,
      (SELECT COALESCE(sum(c.amount_cents),0) FROM administracion.commissions c JOIN administracion.movements x ON x.id=c.movement_id
        WHERE c.paid_on BETWEEN $1::date AND $2::date AND x.voided_at IS NULL) AS commission_paid
      FROM administracion.payments p JOIN administracion.movements m ON m.id=p.movement_id
      WHERE p.date BETWEEN $1::date AND $2::date AND m.voided_at IS NULL`,
      [from, to],
    ),
    query(`SELECT COALESCE(sum(total_cents-paid_cents) FILTER(WHERE kind='salida'),0) AS payable,
      COALESCE(sum(commission_cents) FILTER(WHERE commission_paid_on IS NULL),0) AS employee_payable
      FROM administracion.manual_ledger WHERE voided_at IS NULL AND NOT source_cancelled`),
    query(
      `SELECT l.*,l.date::text, l.commission_paid_on::text FROM administracion.manual_ledger l WHERE ${condition}
      ORDER BY l.date DESC,l.created_at DESC,l.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      values,
    ),
    query(
      `SELECT count(*) AS count FROM administracion.manual_ledger l WHERE ${condition}`,
      values,
    ),
    query<Employee>(
      "SELECT * FROM administracion.employees ORDER BY active DESC,name,id",
    ),
    query<Supplier>(
      "SELECT * FROM administracion.suppliers ORDER BY active DESC,name,id",
    ),
    query(
      `SELECT c.id,c.movement_id,l.date::text,l.concept,l.contact,COALESCE(l.source_folio,l.manual_folio) AS source_folio,c.employee_id,l.employee_name,
      c.amount_cents,c.paid_on::text,l.source_cancelled,l.voided_at
      FROM administracion.commissions c JOIN administracion.manual_ledger l ON l.id=c.movement_id
      WHERE ${view === "comisiones-pendientes" ? "c.paid_on IS NULL AND l.voided_at IS NULL AND $1::date<=$2::date" : "l.date BETWEEN $1::date AND $2::date"} ORDER BY l.date DESC,c.created_at DESC`,
      [from, to],
    ),
  ]);
  const t = totals.rows[0],
    c = cash.rows[0],
    p = pending.rows[0];
  const summary = {
    income: Number(t.income),
    expenses: Number(t.expenses),
    commissions: Number(t.commissions),
    cancelled: Number(t.cancelled),
    collected: Number(c.collected),
    paid: Number(c.paid),
    commissionPaid: Number(c.commission_paid),
    payable: Number(p.payable),
    employeePayable: Number(p.employee_payable),
    profit: 0,
    cash: 0,
  };
  summary.profit = summary.income - summary.expenses - summary.commissions;
  summary.cash = summary.collected - summary.paid - summary.commissionPaid;
  return {
    summary,
    movements: movements.rows.map(movementRow),
    total: Number(count.rows[0].count),
    page,
    pageSize,
    employees: employees.rows,
    suppliers: suppliers.rows,
    range: { from, to },
    commissions: commissions.rows.map((row) => ({
      ...row,
      amount_cents: Number(row.amount_cents),
    })) as CommissionRow[],
    providerNames: [],
  };
}

export async function movementDetail(id: string) {
  uuid(id);
  const [m, p] = await Promise.all([
    query(
      "SELECT l.*,l.date::text,l.commission_paid_on::text FROM administracion.manual_ledger l WHERE id=$1",
      [id],
    ),
    query(
      "SELECT id,date::text,amount_cents,method,reference FROM administracion.payments WHERE movement_id=$1 ORDER BY date,created_at",
      [id],
    ),
  ]);
  if (!m.rows.length)
    throw new ValidationError("El movimiento ya no está disponible.");
  return {
    movement: movementRow(m.rows[0]),
    payments: p.rows.map((row) => ({
      ...row,
      amount_cents: Number(row.amount_cents),
    })) as Payment[],
  };
}

async function lockMovement(client: PoolClient, id: unknown) {
  uuid(id);
  const result = await client.query(
    "SELECT m.*,m.date::text FROM administracion.movements m WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!result.rows[0]) throw new ValidationError("El movimiento no existe.");
  const row = result.rows[0];
  if (row.voided_at) throw new ValidationError("El movimiento está anulado.");
  if (row.source_id) {
    const source = await queryShared(
      `SELECT id${row.source_kind === "ventas" ? ",cancelada" : ""} FROM public.${row.source_kind === "ventas" ? "ventas" : "ventas_productos"} WHERE id=$1`,
      [row.source_id],
    );
    if (!source.rows[0] || source.rows[0].cancelada)
      throw new ValidationError(
        "El ticket de origen está cancelado o no está disponible. Revisa los cobros y comisiones.",
      );
  }
  return row;
}

async function addCommission(
  client: PoolClient,
  movementId: string,
  total: number,
  raw: unknown,
) {
  if (raw == null) return;
  const commission = record(raw);
  if (!commission.employeeId)
    throw new ValidationError("Selecciona un empleado para la comisión.");
  const employeeId = uuid(commission.employeeId);
  const employee = await client.query(
    "SELECT id FROM administracion.employees WHERE id=$1 AND active FOR SHARE",
    [employeeId],
  );
  if (!employee.rows.length)
    throw new ValidationError("Selecciona un empleado activo.");
  if (
    (commission.mode !== undefined && commission.mode !== "fixed") ||
    commission.rememberRate === true
  )
    throw new ValidationError("La comisión se captura como un importe manual.");
  const amount = commissionAmount(total, "fixed", commission.value);
  await client.query(
    "INSERT INTO administracion.commissions(id,movement_id,employee_id,amount_cents,mode,rate_bps) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), movementId, employeeId, amount, "fixed", null],
  );
}

async function addPayment(
  client: PoolClient,
  movementId: string,
  raw: RecordInput,
  initialSalePayment = false,
) {
  const movement = await lockMovement(client, movementId);
  if (movement.kind === "entrada" && !initialSalePayment)
    throw new ValidationError(
      "Las ventas se registran con cobro completo; no admiten abonos posteriores.",
    );
  const amount = cents(raw.amount),
    paidDate = date(raw.date);
  if (paidDate < movement.date)
    throw new ValidationError("El abono no puede ser anterior al movimiento.");
  const previous = await client.query(
    "SELECT COALESCE(sum(amount_cents),0) AS amount FROM administracion.payments WHERE movement_id=$1",
    [movementId],
  );
  if (
    movement.kind === "entrada" &&
    (amount !== Number(movement.total_cents) ||
      Number(previous.rows[0].amount) !== 0)
  )
    throw new ValidationError("Las ventas se registran con cobro completo.");
  if (amount + Number(previous.rows[0].amount) > Number(movement.total_cents))
    throw new ValidationError("El abono supera el saldo pendiente.");
  const id = randomUUID();
  await client.query(
    "INSERT INTO administracion.payments(id,movement_id,date,amount_cents,method,reference) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      movementId,
      paidDate,
      amount,
      method(raw.method),
      text(raw.reference, "Referencia", 160, false),
    ],
  );
  return { id };
}

async function checkEntryIdentity(
  client: PoolClient,
  folio: string,
  origin: string,
  code: string | null,
  manual = false,
) {
  // A single folio lock also serializes unknown-origin manual tickets against either app.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('admin-folio:'||lower(btrim($1)),1))",
    [folio],
  );
  if (code)
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
      "admin-code:" + code,
    ]);
  const identity = code ? parseTicketReference(code) : null;
  const duplicate = await client.query(
    `SELECT id FROM administracion.movements WHERE
    (lower(btrim(COALESCE(source_folio,manual_folio)))=lower(btrim($1)) AND
      ($2='manual' OR COALESCE(source_origin,manual_origin) IN ('manual',$2)) AND
      ($5::boolean OR manual_folio IS NOT NULL)) OR
    ($3::text IS NOT NULL AND (manual_ticket_code=$3 OR (source_kind=$4 AND source_id=$6))) LIMIT 1`,
    [folio, origin, code, identity?.kind || null, manual, identity?.id || null],
  );
  if (duplicate.rows.length)
    throw new ValidationError(
      "Este ticket ya está registrado en Administración (folio o ID repetido).",
    );
}

async function createMovement(client: PoolClient, input: RecordInput) {
  const kind = input.kind;
  if (kind !== "entrada" && kind !== "salida")
    throw new ValidationError("Tipo de movimiento inválido.");
  let lines: Line[],
    total: number,
    subtotal: number,
    tax: number,
    source: Sale | undefined;
  let movementDate = date(input.date),
    contact =
      text(input.contact, "Cliente o proveedor", 160, false) ||
      (kind === "entrada" ? "Público general" : ""),
    phone = text(input.phone, "Teléfono", 40, false);
  let paymentMethod = method(input.method);
  const manual = kind === "entrada" && input.manual === true;
  let manualFolio: string | null = null,
    manualOrigin: string | null = null,
    manualCode: string | null = null;
  if (manual) {
    if (input.source)
      throw new ValidationError(
        "Selecciona registro manual o ticket identificado.",
      );
    manualFolio = text(input.folio, "Folio del ticket", 160);
    manualOrigin = text(input.origin, "Origen", 10);
    if (!["negra", "blanca", "manual"].includes(manualOrigin))
      throw new ValidationError("Selecciona el origen del ticket.");
    if (input.manualTicketCode) {
      manualCode = scanValue(text(input.manualTicketCode, "ID completo", 110));
      if (!parseTicketReference(manualCode))
        throw new ValidationError(
          "Usa el ID completo impreso: LLA1:V:… o LLA1:P:…",
        );
    }
    await checkEntryIdentity(
      client,
      manualFolio,
      manualOrigin,
      manualCode,
      true,
    );
  }
  if (kind === "entrada" && !manual) {
    let identity: RecordInput;
    if (input.source) identity = record(input.source);
    else {
      const code = text(input.ticketCode, "ID de venta del ticket", 100);
      const matches = await lookupSales(code, client);
      if (matches.length !== 1)
        throw new ValidationError(
          matches.length
            ? "Hay varios tickets con ese folio. Usa el código de barras o ID completo."
            : "No encontramos el ID de venta. Usa el ID o código impreso en el ticket.",
        );
      identity = { kind: matches[0].kind, id: matches[0].id };
    }
    if (!["ventas", "ventas_productos"].includes(String(identity.kind)))
      throw new ValidationError("Origen inválido.");
    const sourceId = text(identity.id, "Ticket", 80);
    // Read a snapshot from the source through a SELECT-only connection. No source locks or writes.
    const found = await lookupSales(
      `LLA1:${identity.kind === "ventas" ? "V" : "P"}:${sourceId}`,
      client,
    );
    source = found[0];
    if (!source || source.cancelled)
      throw new ValidationError("No se puede registrar un ticket cancelado.");
    if (source.registeredId)
      throw new ValidationError(
        "Este ticket ya está registrado en Administración.",
      );
    await checkEntryIdentity(
      client,
      source.folio,
      source.origin,
      ticketReference(source.kind, source.id),
    );
  }
  if (source && input.useTicketData === true) {
    lines = source.items;
    total = source.totalCents;
    subtotal = source.subtotalCents;
    tax = source.taxCents;
    movementDate = source.date;
    contact = source.contact;
    phone = source.phone;
    paymentMethod = method(source.method);
    if (total < 1 || subtotal + tax !== total)
      throw new ValidationError(
        "El ticket tiene importes inconsistentes; revisa el sistema de origen.",
      );
  } else {
    lines = manualLines(input.items);
    total = lines.reduce((sum, l) => sum + l.totalCents, 0);
    if (input.vatIncluded !== true && input.vatIncluded !== false)
      throw new ValidationError("Indica si el precio incluye IVA.");
    subtotal = input.vatIncluded ? Math.round(total / 1.16) : total;
    tax = total - subtotal;
  }
  const id = randomUUID();
  let supplierId: string | null = null;
  if (input.supplierId) {
    if (kind !== "salida")
      throw new ValidationError("El proveedor corresponde a una salida.");
    supplierId = uuid(input.supplierId);
    const supplier = await client.query(
      "SELECT name FROM administracion.suppliers WHERE id=$1 AND active FOR SHARE",
      [supplierId],
    );
    if (!supplier.rows.length)
      throw new ValidationError("Selecciona un proveedor activo.");
    contact = supplier.rows[0].name;
  } else if (kind === "salida" && contact) {
    // Remember only the supplier typed in this explicitly confirmed expense.
    const result = await client.query(
      `INSERT INTO administracion.suppliers(id,name,phone,concept,category,method)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(name_key) DO UPDATE SET
      concept=excluded.concept,category=excluded.category,method=excluded.method
      RETURNING id`,
      [
        randomUUID(),
        contact,
        phone,
        text(input.concept, "Concepto", 300),
        text(input.category, "Categoría", 80),
        paymentMethod,
      ],
    );
    supplierId = result.rows[0].id;
  }
  const concept =
    source && input.useTicketData === true
      ? lines
          .map((l) => l.description)
          .join(" · ")
          .slice(0, 300)
      : text(input.concept, "Concepto", 300);
  const category = source
    ? "Venta con ticket"
    : text(input.category, "Categoría", 80);
  const received =
    kind === "entrada" && input.received === undefined
      ? total
      : cents(input.received, "Importe pagado", true);
  if (kind === "entrada" && received !== total)
    throw new ValidationError("Las ventas se registran con cobro completo.");
  if (received > total)
    throw new ValidationError("El pago inicial no puede superar el total.");
  await client.query(
    `INSERT INTO administracion.movements(id,kind,date,concept,category,contact,phone,supplier_id,items,
    subtotal_cents,tax_cents,total_cents,method,reference,notes,source_kind,source_id,source_folio,source_origin,cost_cents,
    manual_folio,manual_origin,manual_ticket_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      id,
      kind,
      movementDate,
      concept,
      category,
      contact,
      phone,
      supplierId,
      JSON.stringify(lines),
      subtotal,
      tax,
      total,
      paymentMethod,
      source && input.useTicketData === true
        ? source.folio
        : manualFolio || text(input.reference, "Referencia", 160, false),
      text(input.notes, "Notas", 2000, false),
      source?.kind || null,
      source?.id || null,
      source?.folio || null,
      source?.origin || null,
      source && input.useTicketData === true ? source.costCents : null,
      manualFolio,
      manualOrigin,
      manualCode,
    ],
  );
  if (input.commission != null) {
    if (kind !== "entrada")
      throw new ValidationError("Solo una entrada puede tener comisión.");
    await addCommission(client, id, total, input.commission);
  }
  if (received > 0)
    await addPayment(
      client,
      id,
      {
        amount: (received / 100).toFixed(2),
        date:
          kind === "entrada" ? movementDate : input.paymentDate || movementDate,
        method: paymentMethod,
        reference: input.reference,
      },
      kind === "entrada",
    );
  return { id };
}

function payoutSnapshot(
  employeeId: string,
  from: string,
  to: string,
  commissions: { id: string; amount_cents: number | string }[],
) {
  const entries = commissions
    .map(
      (commission) =>
        [commission.id.toLowerCase(), Number(commission.amount_cents)] as const,
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256")
    .update(JSON.stringify([1, employeeId.toLowerCase(), from, to, entries]))
    .digest("hex");
}

async function pendingPayoutRows(
  client: PoolClient,
  employeeId: string,
  from: string,
  to: string,
) {
  return client.query<{
    id: string;
    movement_id: string;
    amount_cents: string;
  }>(
    `SELECT c.id,c.movement_id,c.amount_cents
    FROM administracion.commissions c JOIN administracion.movements m ON m.id=c.movement_id
    WHERE c.employee_id=$1 AND c.paid_on IS NULL AND m.voided_at IS NULL
    AND m.date BETWEEN $2::date AND $3::date ORDER BY c.id`,
    [employeeId, from, to],
  );
}

export async function payoutPreview(
  employeeId: string,
  period: string,
  anchor: string,
  customFrom?: string,
  customTo?: string,
): Promise<PayoutPreview> {
  employeeId = uuid(employeeId).toLowerCase();
  const { from, to } = periodRange(period, anchor, customFrom, customTo);
  const employee = await query(
    "SELECT id FROM administracion.employees WHERE id=$1",
    [employeeId],
  );
  if (!employee.rows.length)
    throw new ValidationError("Selecciona un empleado.");
  const result = await query(
    `SELECT c.id,c.movement_id,l.date::text,l.concept,l.contact,COALESCE(l.source_folio,l.manual_folio) AS source_folio,
    c.employee_id,l.employee_name,c.amount_cents,c.paid_on::text,l.source_cancelled,l.voided_at
    FROM administracion.commissions c JOIN administracion.manual_ledger l ON l.id=c.movement_id
    WHERE c.employee_id=$1 AND c.paid_on IS NULL AND l.voided_at IS NULL
    AND l.date BETWEEN $2::date AND $3::date ORDER BY l.date,c.id`,
    [employeeId, from, to],
  );
  const commissions = result.rows.map((row) => ({
    ...row,
    amount_cents: Number(row.amount_cents),
  })) as CommissionRow[];
  return {
    employeeId,
    from,
    to,
    commissions,
    totalCents: commissions.reduce((sum, c) => sum + c.amount_cents, 0),
    snapshot: payoutSnapshot(employeeId, from, to, commissions),
  };
}

async function payCommissions(client: PoolClient, input: RecordInput) {
  const employeeId = uuid(input.employeeId).toLowerCase(),
    paidOn = date(input.paidOn || businessToday());
  const period = text(input.period, "Periodo", 10),
    anchor = typeof input.anchor === "string" ? input.anchor : businessToday();
  const { from, to } = periodRange(
    period,
    anchor,
    input.from as string | undefined,
    input.to as string | undefined,
  );
  const hasSnapshot = input.snapshot !== undefined;
  if (
    hasSnapshot &&
    (typeof input.snapshot !== "string" ||
      !/^[a-f\d]{64}$/.test(input.snapshot))
  )
    throw new ValidationError(
      "Vuelve a revisar las comisiones antes de pagar.",
    );
  // New commissions take a shared employee lock when they are assigned. Holding
  // this row prevents the reviewed pending set from growing during settlement.
  const employee = await client.query(
    "SELECT id FROM administracion.employees WHERE id=$1 FOR UPDATE",
    [employeeId],
  );
  if (!employee.rows.length)
    throw new ValidationError("Selecciona un empleado.");
  let ids: string[];
  if (hasSnapshot) {
    const pending = await pendingPayoutRows(client, employeeId, from, to);
    if (payoutSnapshot(employeeId, from, to, pending.rows) !== input.snapshot)
      throw new ValidationError(
        "Las comisiones cambiaron. Vuelve a revisar el pago.",
      );
    ids = pending.rows.map((commission) => commission.id);
    if (!ids.length)
      throw new ValidationError("No hay comisiones pendientes para pagar.");
  } else {
    if (
      !Array.isArray(input.commissionIds) ||
      !input.commissionIds.length ||
      input.commissionIds.length > 5000
    )
      throw new ValidationError("Selecciona comisiones pendientes para pagar.");
    ids = input.commissionIds.map(uuid);
  }
  if (new Set(ids).size !== ids.length)
    throw new ValidationError("Hay comisiones repetidas.");
  // Lock movements first, in stable order, matching the payment/void lock order.
  // Only commissions explicitly reviewed by the administrator may be settled.
  const initial = await client.query(
    "SELECT movement_id FROM administracion.commissions WHERE id=ANY($1::uuid[]) ORDER BY movement_id",
    [ids],
  );
  if (initial.rows.length !== ids.length)
    throw new ValidationError(
      "Las comisiones cambiaron. Vuelve a revisar el pago.",
    );
  const movements = await client.query<{
    id: string;
    source_kind: string | null;
    source_id: string | null;
    voided_at: string | null;
  }>(
    `SELECT m.id,m.source_kind,m.source_id,m.voided_at FROM administracion.movements m
    WHERE m.id=ANY($1::uuid[]) ORDER BY m.id FOR UPDATE`,
    [initial.rows.map((commission) => commission.movement_id)],
  );
  if (movements.rows.length !== ids.length)
    throw new ValidationError(
      "Las comisiones cambiaron. Vuelve a revisar el pago.",
    );
  if (movements.rows.some((movement) => movement.voided_at))
    throw new ValidationError("El movimiento está anulado.");
  // Source tickets are read in groups; historical payouts need only two source
  // queries regardless of how many individual commissions the owner reviews.
  for (const kind of ["ventas", "ventas_productos"] as const) {
    const sourceIds = [
      ...new Set(
        movements.rows
          .filter(
            (movement) => movement.source_kind === kind && movement.source_id,
          )
          .map((movement) => movement.source_id!),
      ),
    ];
    if (!sourceIds.length) continue;
    const source = await queryShared<{ id: string; cancelada?: boolean }>(
      `SELECT id${kind === "ventas" ? ",cancelada" : ""} FROM public.${kind} WHERE id=ANY($1::text[])`,
      [sourceIds],
    );
    if (
      source.rows.length !== sourceIds.length ||
      source.rows.some((sale) => sale.cancelada)
    )
      throw new ValidationError(
        "El ticket de origen está cancelado o no está disponible. Revisa los cobros y comisiones.",
      );
  }
  const result = await client.query(
    `SELECT c.*,m.date::text FROM administracion.commissions c
    JOIN administracion.movements m ON m.id=c.movement_id WHERE c.id=ANY($1::uuid[])
    ORDER BY c.movement_id FOR UPDATE OF c`,
    [ids],
  );
  for (const row of result.rows) {
    if (
      row.employee_id !== employeeId ||
      row.paid_on ||
      row.date < from ||
      row.date > to
    )
      throw new ValidationError(
        "Alguna comisión ya fue pagada o cambió. Vuelve a revisar el pago.",
      );
    if (paidOn < row.date)
      throw new ValidationError("El pago no puede ser anterior a las ventas.");
  }
  if (hasSnapshot) {
    const pending = await pendingPayoutRows(client, employeeId, from, to);
    if (payoutSnapshot(employeeId, from, to, pending.rows) !== input.snapshot)
      throw new ValidationError(
        "Las comisiones cambiaron. Vuelve a revisar el pago.",
      );
  }
  const total = result.rows.reduce(
    (sum, row) => sum + Number(row.amount_cents),
    0,
  );
  if (!Number.isSafeInteger(total) || total !== input.expectedTotalCents)
    throw new ValidationError("El importe cambió. Vuelve a revisar el pago.");
  const id = randomUUID();
  await client.query(
    `INSERT INTO administracion.commission_payouts
    (id,employee_id,period,date_from,date_to,paid_on,amount_cents,commission_count)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, employeeId, period, from, to, paidOn, total, ids.length],
  );
  const updated = await client.query(
    "UPDATE administracion.commissions SET paid_on=$2,payout_id=$3 WHERE id=ANY($1::uuid[]) AND paid_on IS NULL RETURNING id",
    [ids, paidOn, id],
  );
  if (updated.rowCount !== ids.length)
    throw new ValidationError(
      "El pago ya fue registrado. Actualiza la pantalla.",
    );
  return { id, totalCents: total, count: ids.length };
}

async function executeAction(
  client: PoolClient,
  action: string,
  input: RecordInput,
  requestId: string,
): Promise<RecordInput> {
  if (action === "sale.manual.create") {
    const lines = manualLines([
      {
        description: input.description,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
      },
    ]);
    const today = businessToday();
    return createMovement(client, {
      kind: "entrada",
      manual: true,
      folio: "MAN-" + requestId,
      origin: "manual",
      date: today,
      paymentDate: today,
      concept: lines[0].description,
      category: "Venta manual",
      contact: text(input.contact, "Cliente", 160, false) || "Público general",
      phone: "",
      items: [
        {
          description: lines[0].description,
          quantity: lines[0].quantity,
          unitPrice: input.unitPrice,
        },
      ],
      vatIncluded: false,
      method: input.method,
      received: (lines[0].totalCents / 100).toFixed(2),
      notes: "",
      reference: "",
      commission: input.commission,
    });
  }
  if (action === "movement.create") return createMovement(client, input);
  if (action === "payment.create")
    return addPayment(client, uuid(input.movementId), input);
  if (action === "commission.create") {
    throw new ValidationError("La comisión se asigna al registrar la venta.");
  }
  if (action === "commission.batchPay") return payCommissions(client, input);
  if (action === "preferences.save") {
    throw new ValidationError(
      "La comisión se captura como un importe manual; no se guardan porcentajes.",
    );
  }
  if (action === "commission.pay") {
    const id = uuid(input.id);
    const commission = await client.query(
      "SELECT * FROM administracion.commissions WHERE id=$1",
      [id],
    );
    if (!commission.rows.length)
      throw new ValidationError("La comisión no existe.");
    const movement = await lockMovement(client, commission.rows[0].movement_id);
    const paidOn = date(input.date);
    if (paidOn < movement.date)
      throw new ValidationError("El pago no puede ser anterior a la venta.");
    const result = await client.query(
      "UPDATE administracion.commissions SET paid_on=$2 WHERE id=$1 AND paid_on IS NULL RETURNING id",
      [id, paidOn],
    );
    if (!result.rows.length)
      throw new ValidationError("Esta comisión ya está pagada.");
    return { id };
  }
  if (action === "movement.void") {
    const id = uuid(input.id),
      reason = text(input.reason, "Motivo de anulación", 500);
    // Admin records are voided; the source ticket and inventory remain under their original app.
    const movement = await client.query(
      "SELECT * FROM administracion.movements WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!movement.rows.length || movement.rows[0].voided_at)
      throw new ValidationError("El movimiento ya está anulado o no existe.");
    const paid = await client.query(
      "SELECT id FROM administracion.commissions WHERE movement_id=$1 AND paid_on IS NOT NULL",
      [id],
    );
    if (paid.rows.length)
      throw new ValidationError(
        "No se puede anular una entrada con comisión pagada. Registra primero la corrección correspondiente.",
      );
    await client.query(
      "UPDATE administracion.movements SET voided_at=now(),void_reason=$2 WHERE id=$1",
      [id, reason],
    );
    return { id };
  }
  if (action === "employee.save" || action === "supplier.save") {
    const isEmployee = action === "employee.save",
      id = input.id ? uuid(input.id) : randomUUID();
    const name = text(input.name, "Nombre", 160),
      phone = text(input.phone, "Teléfono", 40, false);
    if (isEmployee) {
      await client.query(
        `INSERT INTO administracion.employees(id,name,phone,position) VALUES($1,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,position=excluded.position`,
        [id, name, phone, text(input.position, "Puesto", 100, false)],
      );
    } else {
      await client.query(
        `INSERT INTO administracion.suppliers(id,name,phone,tax_id,concept,category,method) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,tax_id=excluded.tax_id,concept=excluded.concept,category=excluded.category,method=excluded.method`,
        [
          id,
          name,
          phone,
          text(input.tax_id, "RFC", 20, false),
          text(input.concept, "Concepto habitual", 300, false),
          text(input.category, "Categoría", 80),
          method(input.method),
        ],
      );
    }
    return { id };
  }
  if (action === "employee.active" || action === "supplier.active") {
    const id = uuid(input.id);
    if (typeof input.active !== "boolean")
      throw new ValidationError("Estado inválido.");
    const result = await client.query(
      `UPDATE administracion.${action === "employee.active" ? "employees" : "suppliers"} SET active=$2 WHERE id=$1 RETURNING id`,
      [id, input.active],
    );
    if (!result.rows.length)
      throw new ValidationError("El registro no existe.");
    return { id };
  }
  throw new ValidationError("Acción no reconocida.");
}

/** Serialize retries, compare payload hashes and commit effects + durable outcome atomically. */
export async function mutate(
  action: string,
  payload: unknown,
  requestId: string,
) {
  const input = record(payload);
  uuid(requestId);
  const hash = createHash("sha256")
    .update(JSON.stringify({ action, input }))
    .digest("hex");
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      requestId,
    ]);
    const previous = await client.query(
      "SELECT hash,result FROM administracion.operations WHERE id=$1",
      [requestId],
    );
    if (previous.rows.length) {
      if (previous.rows[0].hash !== hash)
        throw new ValidationError("La solicitud ya fue usada con otros datos.");
      return previous.rows[0].result;
    }
    const result = await executeAction(client, action, input, requestId);
    await client.query(
      "INSERT INTO administracion.operations(id,hash,action,result) VALUES($1,$2,$3,$4::jsonb)",
      [requestId, hash, action, JSON.stringify(result)],
    );
    await client.query(
      "INSERT INTO administracion.audit(action,entity_id,details) VALUES($1,$2,$3::jsonb)",
      [action, result.id, JSON.stringify({ requestId })],
    );
    return result;
  });
}
