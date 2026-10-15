"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Plus,
  ScanLine,
  Trash2,
  Check,
  ArrowRight,
  Focus,
  BadgeDollarSign,
  Wallet,
  ReceiptText,
  ClipboardCheck,
  LockKeyhole,
} from "lucide-react";
import type {
  Employee,
  Supplier,
  Sale,
  Movement,
  Payment,
  PayoutPreview,
} from "@/lib/types";
import {
  businessToday,
  cents,
  periodRange,
  type Line,
  type PeriodSelection,
} from "@/lib/domain";
import { scanValue, isScanTerminator } from "@/lib/scanner";
import { DatePicker, Select, money, shortDate } from "./ui";
import PeriodControls from "./PeriodControls";

export const methodOptions = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
];
function paymentLabel(value: string) {
  return (
    methodOptions.find((option) => option.value === value)?.label || "Otro"
  );
}

function RecordDetails({ movement }: { movement: Movement }) {
  return (
    <details className="record-details">
      <summary>Datos del registro</summary>
      <dl className="detail-grid">
        <div>
          <dt>Registro</dt>
          <dd>
            {movement.source_folio
              ? `Ticket ${movement.source_folio} · Sistema ${movement.source_origin === "blanca" ? "blanco" : "negro"}`
              : movement.kind === "entrada"
                ? "Venta manual · Sin ticket validado"
                : "Registro manual"}
          </dd>
        </div>
        <div>
          <dt>Categoría</dt>
          <dd>{movement.category}</dd>
        </div>
        {!!(movement.reference || movement.manual_folio) && (
          <div className="wide">
            <dt>{movement.source_id ? "Referencia" : "Referencia interna"}</dt>
            <dd>{movement.reference || movement.manual_folio}</dd>
          </div>
        )}
        {movement.source_id && (
          <div className="wide">
            <dt>Código de venta</dt>
            <dd className="ticket-id">
              LLA1:{movement.source_kind === "ventas" ? "V" : "P"}:
              {movement.source_id}
            </dd>
          </div>
        )}
        {movement.manual_ticket_code && (
          <div className="wide">
            <dt>Código del ticket</dt>
            <dd className="ticket-id">{movement.manual_ticket_code}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
export const expenseCategories = [
  "Gasto operativo",
  "Gasto administrativo",
  "Compra de productos",
  "Servicios",
  "Otros gastos",
].map((value) => ({ value, label: value }));
export type Write = (
  action: string,
  payload: unknown,
  requestId: string,
) => Promise<unknown>;
type Saved = (message?: string) => void;
function useSubmit(write: Write, onDone: Saved) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef({ body: "", id: "" });
  async function submit(action: string, payload: unknown, message?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    const body = JSON.stringify({ action, payload });
    if (retry.current.body !== body)
      retry.current = { body, id: crypto.randomUUID() };
    try {
      await write(action, payload, retry.current.id);
      onDone(message);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return { busy, error, submit };
}
function Footer({
  busy,
  onClose,
  label,
  submitDisabled = false,
}: {
  busy: boolean;
  onClose: () => void;
  label: string;
  submitDisabled?: boolean;
}) {
  return (
    <footer className="modal-footer">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={onClose}
      >
        Cancelar
      </button>
      <button className="button primary" disabled={busy || submitDisabled}>
        {busy ? (
          "Guardando…"
        ) : (
          <>
            <Check size={17} />
            {label}
          </>
        )}
      </button>
    </footer>
  );
}
export function CommissionFields({
  employees,
  value,
  onChange,
  total = 0,
}: {
  employees: Employee[];
  value: {
    employeeId: string;
    value: string;
  } | null;
  total?: number;
  onChange: (
    value: {
      employeeId: string;
      value: string;
    } | null,
  ) => void;
}) {
  let amount = 0;
  try {
    if (value) amount = cents(value.value, "Comisión");
  } catch {
    /* Incomplete input while typing. */
  }
  return (
    <div className="commission-box">
      <label className="switch-label">
        <span>
          <strong>
            <BadgeDollarSign size={22} /> Comisión de esta venta
          </strong>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={value !== null}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? {
                    employeeId: "",
                    value: "",
                  }
                : null,
            )
          }
        />
      </label>
      {value && (
        <div className="form-grid commission-fields">
          <Select
            label="Empleado"
            value={value.employeeId}
            options={[
              { value: "", label: "Seleccionar empleado" },
              ...employees
                .filter((e) => e.active)
                .map((e) => ({ value: e.id, label: e.name })),
            ]}
            onChange={(employeeId) => onChange({ ...value, employeeId })}
          />
          <label>
            Monto de comisión
            <input
              inputMode="decimal"
              value={value.value}
              onChange={(event) =>
                onChange({ ...value, value: event.target.value })
              }
              placeholder="0.00"
              required
              aria-invalid={amount > total || undefined}
            />
          </label>
          {!employees.some((e) => e.active) && (
            <p className="hint wide">Agrega un empleado primero.</p>
          )}
          {amount > total && (
            <p className="error wide" role="alert">
              La comisión no puede superar {money(total)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ManualSaleForm({
  employees,
  write,
  onDone,
  onClose,
}: {
  employees: Employee[];
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [unitPrice, setUnitPrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("efectivo"),
    [contact, setContact] = useState("Público general");
  const [withCommission, setWithCommission] = useState(false),
    [employeeId, setEmployeeId] = useState(""),
    [amount, setAmount] = useState("");
  const estimate =
    Math.round((Number(unitPrice) || 0) * 100) * (Number(quantity) || 0);
  const total =
    Number.isSafeInteger(estimate) &&
    estimate >= 0 &&
    estimate <= 99_999_999_999
      ? estimate
      : null;
  let commissionExceedsTotal = false;
  try {
    commissionExceedsTotal =
      withCommission && total !== null && cents(amount, "Comisión") > total;
  } catch {
    /* Validate complete values on save. */
  }
  const activeEmployees = employees.filter((employee) => employee.active);
  const { busy, error, submit } = useSubmit(write, onDone);
  function save(event: FormEvent) {
    event.preventDefault();
    void submit(
      "sale.manual.create",
      {
        description,
        quantity,
        unitPrice,
        method: paymentMethod,
        contact,
        commission: withCommission
          ? {
              employeeId,
              value: amount,
            }
          : null,
      },
      `Venta de ${money(total || 0)} guardada para revisión`,
    );
  }
  return (
    <form
      className="manual-sale-form"
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <div className="manual-sale-body">
        <fieldset className="manual-sale-fields" disabled={busy}>
          <label className="manual-sale-product">
            Producto o servicio
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              placeholder="Ej. Llanta usada 205/55 R16"
              required
              data-autofocus
            />
          </label>
          <div className="manual-sale-row manual-sale-pricing">
            <label>
              Cantidad
              <input
                type="number"
                min="1"
                max="100000"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>
            <label>
              Precio por unidad
              <input
                inputMode="decimal"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                placeholder="$0.00"
                required
              />
            </label>
          </div>
          <div className="manual-sale-row manual-sale-customer">
            <Select
              label="Forma de pago"
              value={paymentMethod}
              onChange={setPaymentMethod}
              options={methodOptions}
            />
            <label>
              Cliente
              <input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={160}
              />
            </label>
          </div>
          <section className="manual-sale-commission">
            <label className="manual-sale-switch">
              <span>
                <BadgeDollarSign size={22} />
                <strong>Agregar comisión</strong>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={withCommission}
                onChange={(event) => setWithCommission(event.target.checked)}
              />
            </label>
            {withCommission && (
              <div className="manual-sale-row manual-sale-commission-fields">
                <Select
                  label="Comisión para"
                  value={employeeId}
                  onChange={setEmployeeId}
                  options={[
                    {
                      value: "",
                      label: activeEmployees.length
                        ? "Seleccionar empleado"
                        : "Sin empleados activos",
                    },
                    ...activeEmployees.map((employee) => ({
                      value: employee.id,
                      label: employee.name,
                    })),
                  ]}
                />
                <label>
                  Monto de comisión
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="$0.00"
                    required
                    aria-invalid={commissionExceedsTotal || undefined}
                  />
                </label>
              </div>
            )}
          </section>
          <div className="manual-sale-total">
            <span>Total de la venta</span>
            <strong className="number">
              {total === null ? "—" : money(total)}
            </strong>
          </div>
          {(error || commissionExceedsTotal) && (
            <div className="manual-sale-error" role="alert">
              {error || "La comisión no puede superar el total de la venta."}
            </div>
          )}
        </fieldset>
      </div>
      <Footer
        busy={busy}
        submitDisabled={total === null || commissionExceedsTotal}
        onClose={onClose}
        label="Guardar venta"
      />
    </form>
  );
}

function SaleBreakdown({
  items,
  subtotal,
  tax,
  total,
}: {
  items: Line[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  const itemAmountLabel =
    tax > 0 && items.reduce((sum, item) => sum + item.totalCents, 0) === total
      ? "Importe con IVA"
      : "Importe";
  return (
    <section className="sale-breakdown" aria-label="Artículos e importes">
      <div className="sale-breakdown-items">
        {items.map((item, index) => (
          <article className="sale-breakdown-item" key={index}>
            <h4>{item.description}</h4>
            <dl>
              <div>
                <dt>Cantidad</dt>
                <dd className="number">{item.quantity}</dd>
              </div>
              <div>
                <dt>Precio por unidad</dt>
                <dd className="number">{money(item.unitCents)}</dd>
              </div>
              <div>
                <dt>{itemAmountLabel}</dt>
                <dd className="number">{money(item.totalCents)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <dl className="sale-breakdown-totals">
        <div>
          <dt>Subtotal</dt>
          <dd className="number">{money(subtotal)}</dd>
        </div>
        <div>
          <dt>IVA</dt>
          <dd className="number">{money(tax)}</dd>
        </div>
        <div className="sale-breakdown-total">
          <dt>Total</dt>
          <dd className="number">{money(total)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function MovementForm({
  kind,
  source,
  employees,
  suppliers,
  providerNames,
  write,
  onDone,
  onClose,
}: {
  kind: "entrada" | "salida";
  source?: Sale;
  employees: Employee[];
  suppliers: Supplier[];
  providerNames: string[];
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const today = businessToday();
  const [recordDate, setDate] = useState(source?.date || today),
    [paymentDate, setPaymentDate] = useState(source?.date || today);
  const [contact, setContact] = useState(
      source?.contact || (kind === "entrada" ? "Público general" : ""),
    ),
    [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState(
      source
        ? "Venta con ticket"
        : kind === "entrada"
          ? "Venta de productos"
          : "Gasto operativo",
    ),
    [concept, setConcept] = useState("");
  const [method, setMethod] = useState(source?.method || "efectivo"),
    [vatIncluded, setVat] = useState(false);
  const [items, setItems] = useState([
    { description: "", quantity: "1", unitPrice: "" },
  ]);
  const [received, setReceived] = useState(""),
    [partial, setPartial] = useState(false);
  const [manualOrigin, setManualOrigin] = useState("manual");
  const [commission, setCommission] = useState<{
    employeeId: string;
    value: string;
  } | null>(null);
  const { busy, error, submit } = useSubmit(write, onDone);
  const total =
    source?.totalCents ??
    items.reduce(
      (sum, l) =>
        sum +
        Math.round((Number(l.unitPrice) || 0) * 100) *
          (Number(l.quantity) || 0),
      0,
    );
  function selectSupplier(s: Supplier) {
    setContact(s.name);
    setSupplierId(s.id);
    setMethod(s.method);
    setCategory(s.category);
    setConcept(s.concept);
    setItems([{ description: s.concept, quantity: "1", unitPrice: "" }]);
  }
  function changeLine(index: number, key: string, value: string) {
    setItems(
      items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
    if (index === 0 && key === "description") setConcept(value);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void submit(
      "movement.create",
      {
        kind,
        date: recordDate,
        paymentDate:
          kind === "salida" && partial
            ? paymentDate < recordDate
              ? recordDate
              : paymentDate
            : recordDate,
        contact,
        phone: source?.phone || f.get("phone") || "",
        manual: kind === "entrada" && !source,
        folio: f.get("folio"),
        origin: manualOrigin,
        manualTicketCode: f.get("manualTicketCode"),
        category,
        concept: concept || items[0].description,
        ticketCode: f.get("ticketCode"),
        useTicketData: !!source,
        items,
        vatIncluded,
        method,
        supplierId: supplierId || undefined,
        reference: f.get("reference"),
        notes: f.get("notes"),
        received:
          kind === "salida" && partial ? received : (total / 100).toFixed(2),
        commission,
        source: source ? { kind: source.kind, id: source.id } : undefined,
      },
      kind === "entrada"
        ? `Venta de ${money(total)} ${source ? "registrada" : "guardada para revisión"}`
        : `Gasto de ${money(total)} registrado`,
    );
  }
  return (
    <form
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <div className="modal-body">
        <fieldset disabled={busy} className="form-stack">
          {kind === "entrada" && !source && (
            <>
              <div className="manual-entry-badge">
                <ReceiptText size={22} />
                <strong>Registro manual</strong>
              </div>
              <div className="form-grid">
                <label>
                  Folio del ticket
                  <input
                    name="folio"
                    maxLength={160}
                    placeholder="Folio o número de control"
                    required
                    data-autofocus
                  />
                </label>
                <Select
                  label="Origen del ticket"
                  value={manualOrigin}
                  onChange={setManualOrigin}
                  options={[
                    { value: "manual", label: "Sin sistema" },
                    { value: "negra", label: "Sistema negro" },
                    { value: "blanca", label: "Sistema blanco" },
                  ]}
                />
              </div>
              <label>
                ID completo del ticket{" "}
                <span className="optional">Si aparece impreso</span>
                <input
                  name="manualTicketCode"
                  maxLength={110}
                  placeholder="LLA1:V:… o LLA1:P:…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </>
          )}
          {source && (
            <div className="ticket-origin">
              <ScanLine size={24} />
              <div>
                <strong>{source.folio}</strong>
                <span>
                  {source.origin === "blanca" ? "Blanco" : "Negro"} ·{" "}
                  {shortDate(source.date)}
                </span>
              </div>
              <span className="pill success">Ticket identificado</span>
            </div>
          )}
          <div className="form-grid">
            <DatePicker
              label="Fecha del movimiento"
              value={recordDate}
              onChange={setDate}
              disabled={!!source}
            />
            {kind === "salida" ? (
              <Select
                label="Tipo de movimiento"
                value={category}
                onChange={setCategory}
                options={expenseCategories}
              />
            ) : (
              <Select
                label="Tipo de entrada"
                disabled={!!source}
                value={category}
                onChange={setCategory}
                options={(source
                  ? ["Venta con ticket"]
                  : [
                      "Venta de productos",
                      "Venta de servicios",
                      "Otros ingresos",
                    ]
                ).map((value) => ({ value, label: value }))}
              />
            )}
          </div>
          {source && (
            <div className="ticket-customer">
              <span>{source.phone || "Sin teléfono"}</span>
            </div>
          )}
          {kind === "salida" && (
            <div className="supplier-autocomplete">
              <label>
                Proveedor o comercio <span className="optional">Opcional</span>
                <input
                  list="provider-names"
                  value={contact}
                  onChange={(event) => {
                    setContact(event.target.value);
                    const match = suppliers.find(
                      (s) =>
                        s.active &&
                        s.name.toLocaleLowerCase() ===
                          event.target.value.toLocaleLowerCase(),
                    );
                    if (match) selectSupplier(match);
                    else setSupplierId("");
                  }}
                  placeholder="Buscar proveedor por nombre…"
                  autoComplete="off"
                />
              </label>
              <datalist id="provider-names">
                {[
                  ...new Set([
                    ...suppliers.filter((s) => s.active).map((s) => s.name),
                    ...providerNames,
                  ]),
                ].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {contact &&
                suppliers
                  .filter(
                    (s) =>
                      s.active &&
                      s.name.toLowerCase().includes(contact.toLowerCase()) &&
                      s.id !== supplierId,
                  )
                  .slice(0, 4)
                  .map((s) => (
                    <button
                      type="button"
                      className="supplier-suggestion"
                      key={s.id}
                      onClick={() => selectSupplier(s)}
                    >
                      <strong>{s.name}</strong>
                      <span>
                        {s.concept || s.category}
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  ))}
            </div>
          )}
          {source ? (
            <SaleBreakdown
              items={source.items}
              subtotal={source.subtotalCents}
              tax={source.taxCents}
              total={source.totalCents}
            />
          ) : (
            <div className="line-editor">
              {items.map((line, i) => (
                <div className="line-row" key={i}>
                  <label className="line-description">
                    {kind === "entrada" ? "Producto o servicio" : "Concepto"}
                    <input
                      value={line.description}
                      onChange={(event) =>
                        changeLine(i, "description", event.target.value)
                      }
                      placeholder={
                        kind === "entrada"
                          ? "Ej. Llanta usada 205/55 R16"
                          : "Ej. Material de limpieza"
                      }
                      maxLength={300}
                      required
                      autoFocus={i === 0}
                    />
                  </label>
                  <label>
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      value={line.quantity}
                      onChange={(event) =>
                        changeLine(i, "quantity", event.target.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    Precio por unidad
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.unitPrice}
                      onChange={(event) =>
                        changeLine(i, "unitPrice", event.target.value)
                      }
                      required
                    />
                  </label>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="icon-button remove-line"
                      aria-label={`Eliminar concepto ${i + 1}`}
                      onClick={() =>
                        setItems(items.filter((_, index) => index !== i))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setItems([
                    ...items,
                    { description: "", quantity: "1", unitPrice: "" },
                  ])
                }
              >
                <Plus size={15} />
                Agregar otro concepto
              </button>
            </div>
          )}
          <div className="form-grid">
            <Select
              label="Forma de pago"
              value={method}
              onChange={setMethod}
              options={methodOptions}
              disabled={!!source}
            />
            {kind === "entrada" ? (
              <label>
                Cliente
                <input
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  maxLength={160}
                  disabled={!!source}
                />
              </label>
            ) : (
              <label>
                Folio o referencia <span className="optional">Opcional</span>
                <input name="reference" maxLength={160} />
              </label>
            )}
          </div>
          {!source && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={vatIncluded}
                onChange={(event) => setVat(event.target.checked)}
              />
              El precio incluye IVA del 16%
            </label>
          )}
          {kind === "entrada" && !source && (
            <label>
              Teléfono <span className="optional">Opcional</span>
              <input name="phone" maxLength={40} />
            </label>
          )}
          {kind === "salida" && (
            <div className="payment-box">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(event) => setPartial(event.target.checked)}
                />
                Pago parcial o pendiente
              </label>
              {partial && (
                <div className="form-grid">
                  <label>
                    Pagado ($)
                    <input
                      value={received}
                      onChange={(event) => setReceived(event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      required
                    />
                  </label>
                  <DatePicker
                    label="Fecha del pago"
                    value={paymentDate}
                    onChange={setPaymentDate}
                  />
                </div>
              )}
            </div>
          )}
          {kind === "entrada" && (
            <CommissionFields
              employees={employees}
              value={commission}
              onChange={setCommission}
              total={total}
            />
          )}
          <label>
            Nota <span className="optional">Opcional</span>
            <textarea name="notes" maxLength={2000} rows={2} />
          </label>
          {!source && (
            <div className="form-total">
              <span>Total</span>
              <strong className="number">{money(total)}</strong>
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
        </fieldset>
      </div>
      <Footer
        busy={busy}
        onClose={onClose}
        label={kind === "entrada" ? "Confirmar venta" : "Guardar salida"}
      />
    </form>
  );
}

export function TicketLookup({
  onSelect,
  allowedMovementId,
  compact = false,
}: {
  onSelect: (sale: Sale) => void;
  allowedMovementId?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null),
    inFlight = useRef(false);
  const [focused, setFocused] = useState(false);
  const [code, setCode] = useState(""),
    [sales, setSales] = useState<Sale[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  async function lookup() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSales(null);
    try {
      const response = await fetch(
        "/api/admin?ticket=" +
          encodeURIComponent(scanValue(inputRef.current?.value || code)),
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setSales(result.sales);
      if (
        result.sales.length === 1 &&
        !result.sales[0].cancelled &&
        (!result.sales[0].registeredId ||
          result.sales[0].registeredId === allowedMovementId)
      )
        onSelect(result.sales[0]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      inFlight.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }
  return (
    <div
      className={compact ? "review-lookup form-stack" : "modal-body form-stack"}
    >
      {!compact && (
        <div className={"scanner-stage " + (focused ? "armed" : "")}>
          <ScanLine size={52} strokeWidth={1.6} />
          <strong>
            {busy
              ? "Buscando ticket…"
              : focused
                ? "Listo para escanear"
                : "Activar lector"}
          </strong>
          <span>Escanea el código o escribe el folio</span>
          {!focused && (
            <button
              type="button"
              className="button secondary"
              onClick={() => inputRef.current?.focus()}
            >
              <Focus size={20} />
              Activar
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
        className="scan-form"
      >
        <label>
          Código o folio
          <input
            ref={inputRef}
            data-autofocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (
                isScanTerminator(event.key) &&
                event.currentTarget.value.trim()
              ) {
                event.preventDefault();
                void lookup();
              }
            }}
            placeholder="Código de barras o folio del ticket"
            autoComplete="off"
            spellCheck={false}
            readOnly={busy}
            autoFocus
            required
            maxLength={110}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Buscando…" : "Buscar ticket"}
          <ArrowRight size={19} />
        </button>
      </form>
      <p className="scanner-help">
        Lector en modo teclado · Enter o Tab al terminar
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {sales?.length === 0 && (
        <div className="empty compact">
          <strong>No encontramos ese ticket</strong>
          <p>Comprueba el código o folio impreso.</p>
        </div>
      )}
      {sales && sales.length > 0 && (
        <div className="ticket-results">
          {sales.map((sale) => (
            <button
              key={sale.kind + sale.id}
              className="ticket-result"
              disabled={
                sale.cancelled ||
                (!!sale.registeredId && sale.registeredId !== allowedMovementId)
              }
              onClick={() => onSelect(sale)}
            >
              <div>
                <strong>
                  {sale.items
                    .map((item) => `${item.quantity} × ${item.description}`)
                    .join(" · ")}
                </strong>
                <small>
                  {sale.contact} · {shortDate(sale.date)} ·{" "}
                  {paymentLabel(sale.method)}
                </small>
                <small>Folio {sale.folio}</small>
                <span className="hint">
                  {sale.cancelled
                    ? "Ticket cancelado"
                    : sale.registeredId &&
                        sale.registeredId !== allowedMovementId
                      ? "Ya registrado en Administración"
                      : "Cargar y revisar"}
                </span>
              </div>
              <strong className="number">{money(sale.totalCents)}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SaleReviewForm({
  movement,
  write,
  onDone,
  onClose,
}: {
  movement: Movement;
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Sale | null>(null),
    [manualApproval, setManualApproval] = useState(false),
    [findingTicket, setFindingTicket] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [commissionValue, setCommissionValue] = useState("");
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (source || manualApproval) reviewHeadingRef.current?.focus();
  }, [source, manualApproval]);
  const { busy, error, submit } = useSubmit(write, onDone);
  const correctionRequired =
    !!source &&
    !!movement.commission_id &&
    (movement.commission_cents || 0) > source.totalCents;
  let correctedCents = 0;
  try {
    correctedCents = cents(commissionValue, "Comisión");
  } catch {
    /* Incomplete input is checked before confirmation. */
  }
  const validCorrection =
    !correctionRequired ||
    (correctedCents > 0 && correctedCents <= source!.totalCents);
  const canLink = !movement.commission_paid_on;
  function reset() {
    setSource(null);
    setManualApproval(false);
    setConfirmed(false);
    setCommissionValue("");
    setFindingTicket(true);
  }
  return (
    <div className="sale-review">
      <div className="modal-body form-stack">
        <div className="review-record">
          <div>
            <span
              className={
                "pill " +
                (movement.review_status === "pending"
                  ? "review-pill"
                  : "manual-approved")
              }
            >
              {movement.review_status === "pending"
                ? "Requiere revisión"
                : "Manual aprobada"}
            </span>
            <h3 tabIndex={-1} data-autofocus>
              {movement.concept}
            </h3>
            <small>
              {movement.review_status === "pending"
                ? "No incluida en ventas ni ganancias"
                : "Aprobada sin ticket"}
            </small>
          </div>
          <strong className="number">{money(movement.total_cents)}</strong>
        </div>
        <dl className="sale-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{movement.contact || "Público general"}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{shortDate(movement.date)}</dd>
          </div>
          <div>
            <dt>Forma de pago</dt>
            <dd>{paymentLabel(movement.method)}</dd>
          </div>
          <div>
            <dt>Comisión</dt>
            <dd>
              {movement.commission_id
                ? `${money(movement.commission_cents || 0)} · ${movement.employee_name}`
                : "Sin comisión"}
            </dd>
          </div>
        </dl>
        <SaleBreakdown
          items={movement.items}
          subtotal={movement.subtotal_cents}
          tax={movement.tax_cents}
          total={movement.total_cents}
        />
        {movement.review_status === "pending" &&
          movement.commission_id &&
          !movement.commission_paid_on && (
            <div className="review-commission-note">
              <LockKeyhole size={18} />
              Comisión en espera de aprobación
            </div>
          )}
        {!source && !manualApproval && (
          <>
            <div className="review-decisions">
              {movement.review_status === "pending" && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setManualApproval(true)}
                >
                  Aprobar sin ticket
                </button>
              )}
              {canLink && !findingTicket && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setFindingTicket(true)}
                >
                  Buscar ticket
                </button>
              )}
            </div>
            {canLink && findingTicket ? (
              <TicketLookup
                compact
                allowedMovementId={movement.id}
                onSelect={(sale) => {
                  setSource(sale);
                  setConfirmed(false);
                }}
              />
            ) : !canLink ? (
              <p className="warning">
                La comisión ya fue pagada. No se puede reemplazar esta venta.
              </p>
            ) : null}
          </>
        )}
        {source && (
          <>
            <div className="review-source-heading">
              <div>
                <span className="eyebrow">TICKET ENCONTRADO</span>
                <h3 ref={reviewHeadingRef} tabIndex={-1}>
                  Datos del ticket
                </h3>
                <p>
                  {source.contact} · {shortDate(source.date)}
                </p>
                <small>
                  {paymentLabel(source.method)} · Folio {source.folio}
                </small>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={reset}
                disabled={busy}
              >
                Buscar otro
              </button>
            </div>
            <div className="review-comparison">
              <div>
                <span>Total manual</span>
                <strong className="number">
                  {money(movement.total_cents)}
                </strong>
              </div>
              <div>
                <span>Total del ticket</span>
                <strong className="number">{money(source.totalCents)}</strong>
              </div>
            </div>
            <SaleBreakdown
              items={source.items}
              subtotal={source.subtotalCents}
              tax={source.taxCents}
              total={source.totalCents}
            />
            <p className="review-replacement-note">
              Al confirmar, los datos del ticket reemplazan esta venta manual.
            </p>
          </>
        )}
        {manualApproval && (
          <>
            <div className="review-source-heading">
              <h3 ref={reviewHeadingRef} tabIndex={-1}>
                Aprobar sin ticket
              </h3>
              <button
                className="text-button"
                type="button"
                onClick={reset}
                disabled={busy}
              >
                Buscar ticket
              </button>
            </div>
            <p className="review-replacement-note">
              Confirma lo capturado para incluir esta venta en el Resumen.
            </p>
          </>
        )}
        {(source || manualApproval) && (
          <form
            id="sale-review-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmed || !validCorrection) return;
              void submit(
                source ? "movement.review.validate" : "movement.review.approve",
                {
                  id: movement.id,
                  reviewVersion: movement.review_version,
                  ...(source
                    ? {
                        sourceKind: source.kind,
                        sourceId: source.id,
                        sourceFingerprint: source.fingerprint,
                        ...(correctionRequired ? { commissionValue } : {}),
                      }
                    : {}),
                },
                source
                  ? `Venta validada por ${money(source.totalCents)}`
                  : `Venta de ${money(movement.total_cents)} aprobada`,
              );
            }}
          >
            <fieldset className="form-stack" disabled={busy}>
              {correctionRequired && (
                <div className="review-commission-confirm">
                  <strong>Comisión · {movement.employee_name}</strong>
                  <label>
                    Nuevo monto de comisión
                    <input
                      value={commissionValue}
                      onChange={(event) =>
                        setCommissionValue(event.target.value)
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      required
                      aria-invalid={!!commissionValue && !validCorrection}
                    />
                    <small>
                      Máximo {money(source!.totalCents)}. La comisión actual
                      supera el ticket.
                    </small>
                  </label>
                </div>
              )}
              <label className="check-label review-confirmation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                />
                <span>
                  {source
                    ? "Confirmo los datos del ticket"
                    : "Confirmo esta venta manual"}
                  {movement.commission_id && !movement.commission_paid_on
                    ? " y autorizo su comisión."
                    : "."}
                </span>
              </label>
            </fieldset>
          </form>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <RecordDetails movement={movement} />
      </div>
      <footer className="modal-footer">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancelar
        </button>
        {(source || manualApproval) && (
          <button
            className="button primary"
            form="sale-review-confirm"
            disabled={busy || !confirmed || !validCorrection}
          >
            <ClipboardCheck size={19} />
            {busy
              ? "Guardando…"
              : source
                ? "Validar y actualizar"
                : "Aprobar venta manual"}
          </button>
        )}
      </footer>
    </div>
  );
}

export function MasterForm({
  kind,
  initial,
  write,
  onDone,
  onClose,
}: {
  kind: "employee" | "supplier";
  initial?: Employee | Supplier;
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const supplier = initial as Supplier | undefined;
  const [category, setCategory] = useState(
      supplier?.category || "Compra de productos",
    ),
    [method, setMethod] = useState(supplier?.method || "transferencia");
  const { busy, error, submit } = useSubmit(write, onDone);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void submit(
      kind + ".save",
      {
        ...Object.fromEntries(f),
        id: initial?.id,
        category,
        method,
      },
      `${kind === "employee" ? "Empleado" : "Proveedor"} ${String(f.get("name") || "").trim()} ${initial ? "actualizado" : "agregado"}`,
    );
  }
  return (
    <form onSubmit={save}>
      <div className="modal-body">
        <fieldset className="form-stack" disabled={busy}>
          <label>
            Nombre
            <input
              name="name"
              defaultValue={initial?.name || ""}
              maxLength={160}
              required
              autoFocus
            />
          </label>
          <div className="form-grid">
            <label>
              Teléfono <span className="optional">Opcional</span>
              <input
                name="phone"
                defaultValue={initial?.phone || ""}
                maxLength={40}
              />
            </label>
            {kind === "employee" ? (
              <label>
                Puesto <span className="optional">Opcional</span>
                <input
                  name="position"
                  defaultValue={(initial as Employee)?.position || ""}
                  maxLength={100}
                />
              </label>
            ) : (
              <label>
                RFC <span className="optional">Opcional</span>
                <input
                  name="tax_id"
                  defaultValue={supplier?.tax_id || ""}
                  maxLength={20}
                />
              </label>
            )}
          </div>
          {kind === "supplier" && (
            <>
              <label>
                Concepto habitual
                <input
                  name="concept"
                  defaultValue={supplier?.concept || ""}
                  placeholder="Ej. Compra de llantas"
                  maxLength={300}
                />
              </label>
              <div className="form-grid">
                <Select
                  label="Tipo de movimiento habitual"
                  value={category}
                  onChange={setCategory}
                  options={expenseCategories}
                />
                <Select
                  label="Forma de pago habitual"
                  value={method}
                  onChange={setMethod}
                  options={methodOptions}
                />
              </div>
              <p className="hint">
                Estos datos se completan al seleccionar al proveedor en una
                salida. El importe se captura en cada operación.
              </p>
            </>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
      </div>
      <Footer busy={busy} onClose={onClose} label="Guardar" />
    </form>
  );
}

export function PaymentForm({
  movement,
  write,
  onDone,
  onClose,
}: {
  movement: Movement;
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const [date, setDate] = useState(businessToday()),
    [method, setMethod] = useState(movement.method);
  const { busy, error, submit } = useSubmit(write, onDone);
  if (movement.kind === "entrada") {
    return (
      <div className="modal-body form-stack">
        <p>Las ventas se registran pagadas por completo.</p>
        <button className="button secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        void submit(
          "payment.create",
          {
            ...Object.fromEntries(values),
            movementId: movement.id,
            date,
            method,
          },
          `Pagaste ${money(Math.round(Number(values.get("amount")) * 100))} a ${movement.contact || movement.concept}`,
        );
      }}
    >
      <div className="modal-body">
        <fieldset className="form-stack" disabled={busy}>
          <div className="balance-callout">
            <span>{movement.contact || movement.concept}</span>
            <small>Saldo pendiente</small>
            <strong className="number">
              {money(movement.total_cents - movement.paid_cents)}
            </strong>
          </div>
          <div className="form-grid">
            <label>
              Importe del abono ($)
              <input
                name="amount"
                defaultValue={(
                  (movement.total_cents - movement.paid_cents) /
                  100
                ).toFixed(2)}
                inputMode="decimal"
                required
                autoFocus
              />
            </label>
            <DatePicker
              label="Fecha del abono"
              value={date}
              onChange={setDate}
            />
          </div>
          <Select
            label="Forma de pago"
            value={method}
            onChange={setMethod}
            options={methodOptions}
          />
          <label>
            Referencia <span className="optional">Opcional</span>
            <input name="reference" maxLength={160} />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
      </div>
      <Footer busy={busy} onClose={onClose} label="Guardar" />
    </form>
  );
}

export function PayoutForm({
  employees,
  initialEmployeeId,
  initialPeriod,
  initialAnchor,
  initialFrom,
  initialTo,
  write,
  onDone,
  onClose,
}: {
  employees: Employee[];
  initialEmployeeId?: string;
  initialPeriod?: PeriodSelection["period"];
  initialAnchor?: string;
  initialFrom?: string;
  initialTo?: string;
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId || "");
  const [selection, setSelection] = useState<PeriodSelection>({
    period: initialPeriod || "all",
    anchor: initialAnchor || businessToday(),
    from: initialFrom || businessToday(),
    to: initialTo || businessToday(),
  });
  const { period, anchor, from, to } = selection;
  const [preview, setPreview] = useState<PayoutPreview | null>(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [revision, setRevision] = useState(0);
  const { busy, error, submit } = useSubmit(write, onDone);
  let range: { from: string; to: string } | null = null;
  let rangeError = "";
  try {
    range = periodRange(period, anchor, from, to);
  } catch (error) {
    rangeError = (error as Error).message;
  }
  useEffect(() => {
    setPreview(null);
    setLoadError("");
    if (!employeeId || !range) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      payout: "1",
      employeeId,
      period,
      anchor,
      from,
      to,
    });
    void fetch("/api/admin?" + params, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setPreview(result);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [employeeId, period, anchor, from, to, !!range, revision]);
  const current =
    range &&
    preview?.employeeId === employeeId &&
    preview.from === range.from &&
    preview.to === range.to
      ? preview
      : null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!current?.commissions.length || loading) return;
        void submit(
          "commission.batchPay",
          {
            employeeId,
            period,
            anchor,
            from,
            to,
            snapshot: current.snapshot,
            expectedTotalCents: current.totalCents,
          },
          `Pagaste ${money(current.totalCents)} a ${employees.find((employee) => employee.id === employeeId)?.name || "este empleado"}`,
        );
      }}
    >
      <div className="modal-body">
        <fieldset className="form-stack" disabled={busy}>
          <Select
            label="Empleado"
            value={employeeId}
            options={[
              { value: "", label: "Seleccionar empleado" },
              ...employees.map((e) => ({
                value: e.id,
                label: e.name + (e.active ? "" : " (eliminado)"),
              })),
            ]}
            onChange={setEmployeeId}
          />
          <PeriodControls value={selection} onChange={setSelection} allowAll />
          <div className="payout-summary">
            <Wallet size={30} />
            <div>
              <span>Total a pagar</span>
              <strong className="number">
                {loading ? "…" : money(current?.totalCents || 0)}
              </strong>
              <small>
                {current?.commissions.length || 0}{" "}
                {current?.commissions.length === 1
                  ? "comisión lista para pagar"
                  : "comisiones listas para pagar"}
              </small>
            </div>
          </div>
          {loading && <p role="status">Consultando comisiones…</p>}
          {!!current?.frozenCount && (
            <div className="review-commission-note">
              <LockKeyhole size={18} />
              {current.frozenCount}{" "}
              {current.frozenCount === 1 ? "comisión por revisar" : "comisiones por revisar"} ·{" "}
              {money(current.frozenCents)}
            </div>
          )}
          {current && (
            <div className="payout-lines">
              {current.commissions.map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{c.concept}</strong>
                    <small>
                      {shortDate(c.date)} · {c.contact || "Público general"}
                    </small>
                  </span>
                  <strong className="number">{money(c.amount_cents)}</strong>
                </div>
              ))}
              {!current.commissions.length && (
                <div className="empty compact">
                  {current.frozenCount
                    ? "Sin comisiones liberadas para pagar"
                    : "Sin comisiones pendientes en este periodo"}
                </div>
              )}
            </div>
          )}
          {(error || loadError || rangeError) && (
            <div className="error" role="alert">
              {error || loadError || rangeError}
              <button
                type="button"
                className="text-button"
                onClick={() => setRevision((n) => n + 1)}
              >
                Actualizar pendientes
              </button>
            </div>
          )}
        </fieldset>
      </div>
      <Footer
        busy={busy}
        submitDisabled={loading || !current?.commissions.length}
        onClose={onClose}
        label={"Pagar " + money(current?.totalCents || 0)}
      />
    </form>
  );
}

export function ConfirmForm({
  action,
  entityId,
  write,
  onDone,
  onClose,
}: {
  action: "commission.pay" | "movement.void";
  entityId: string;
  write: Write;
  onDone: Saved;
  onClose: () => void;
}) {
  const [date, setDate] = useState(businessToday());
  const { busy, error, submit } = useSubmit(write, onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(
          action,
          {
            id: entityId,
            date,
            ...Object.fromEntries(new FormData(event.currentTarget)),
          },
          action === "commission.pay" ? "Comisión pagada" : "Registro anulado",
        );
      }}
    >
      <div className="modal-body">
        <fieldset className="form-stack" disabled={busy}>
          {action === "commission.pay" ? (
            <DatePicker label="Fecha de pago" value={date} onChange={setDate} />
          ) : (
            <label>
              Motivo
              <textarea
                name="reason"
                maxLength={500}
                required
                autoFocus
                rows={3}
              />
            </label>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
      </div>
      <Footer
        busy={busy}
        onClose={onClose}
        label={action === "commission.pay" ? "Confirmar pago" : "Anular"}
      />
    </form>
  );
}

export function DetailView({
  movement,
  payments,
  onPayment,
  onVoid,
  onReview,
}: {
  movement: Movement;
  payments: Payment[];
  onPayment: () => void;
  onVoid: () => void;
  onReview: () => void;
}) {
  const inactive = movement.source_cancelled || !!movement.voided_at;
  return (
    <div className="modal-body form-stack">
      {!inactive && movement.kind === "entrada" && !movement.source_id && (
        <div className="review-detail-banner">
          <div>
            <strong>
              {movement.review_status === "pending"
                ? "Requiere revisión"
                : "Manual aprobada"}
            </strong>
            <span>
              Sin folio validado
              {movement.review_status === "pending" &&
              movement.commission_id &&
              !movement.commission_paid_on
                ? " · Comisión congelada"
                : ""}
            </span>
          </div>
          {(movement.review_status === "pending" ||
            !movement.commission_paid_on) && (
            <button className="button secondary small" onClick={onReview}>
              {movement.review_status === "pending"
                ? "Revisar venta"
                : "Vincular ticket"}
            </button>
          )}
        </div>
      )}
      {inactive && (
        <div className="warning">
          {movement.voided_at
            ? `Registro anulado: ${movement.void_reason}`
            : "El ticket de origen fue cancelado. La entrada y la comisión se excluyen de las ganancias; revisa si corresponde devolver los cobros o recuperar una comisión pagada."}
        </div>
      )}
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            {movement.kind === "entrada" ? "ENTRADA" : "SALIDA"} ·{" "}
            {shortDate(movement.date)}
          </span>
          <h3>{movement.concept}</h3>
          <p>{movement.contact || movement.category}</p>
        </div>
        <strong className="number">{money(movement.total_cents)}</strong>
      </div>
      <dl className="sale-facts">
        <div>
          <dt>Fecha</dt>
          <dd>{shortDate(movement.date)}</dd>
        </div>
        <div>
          <dt>{movement.kind === "entrada" ? "Cliente" : "Proveedor"}</dt>
          <dd>
            {movement.contact ||
              (movement.kind === "entrada"
                ? "Público general"
                : "Sin proveedor")}
          </dd>
        </div>
        <div>
          <dt>Forma de pago</dt>
          <dd>{paymentLabel(movement.method)}</dd>
        </div>
        <div>
          <dt>{movement.kind === "entrada" ? "Estado" : "Saldo pendiente"}</dt>
          <dd className="number">
            {inactive
              ? "No aplica"
              : movement.kind === "entrada"
                ? movement.review_status === "pending"
                  ? "Por revisar"
                  : "Confirmada"
                : money(movement.total_cents - movement.paid_cents)}
          </dd>
        </div>
      </dl>
      <SaleBreakdown
        items={movement.items}
        subtotal={movement.subtotal_cents}
        tax={movement.tax_cents}
        total={movement.total_cents}
      />
      {movement.commission_id && (
        <div className="commission-detail">
          <strong>Comisión · {movement.employee_name}</strong>
          <span>
            {money(movement.commission_cents || 0)} ·{" "}
            {movement.commission_paid_on
              ? `Pagada ${shortDate(movement.commission_paid_on)}`
              : movement.review_status === "pending"
                ? "Congelada · Requiere revisión"
                : "Pendiente de pago"}
          </span>
        </div>
      )}
      <details className="record-details">
        <summary>
          {movement.kind === "entrada"
            ? "Pago registrado"
            : "Pagos registrados"}
        </summary>
        {payments.length ? (
          <div className="payment-history">
            {payments.map((payment) => (
              <div key={payment.id}>
                <span>
                  {shortDate(payment.date)}
                  <small>
                    {paymentLabel(payment.method)}
                    {payment.reference ? " · " + payment.reference : ""}
                  </small>
                </span>
                <strong className="number">
                  {money(payment.amount_cents)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Aún no hay pagos registrados.</p>
        )}
      </details>
      <RecordDetails movement={movement} />
      {movement.notes && (
        <div className="notes">
          <span className="eyebrow">NOTA ADICIONAL</span>
          <p>{movement.notes}</p>
        </div>
      )}
      {!inactive && (
        <div className="detail-actions">
          {movement.kind === "salida" &&
            movement.paid_cents < movement.total_cents && (
              <button className="button primary" onClick={onPayment}>
                Registrar pago
              </button>
            )}
          <button className="text-button danger" onClick={onVoid}>
            Anular registro
          </button>
        </div>
      )}
    </div>
  );
}
