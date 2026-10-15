"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Plus,
  ScanLine,
  Trash2,
  Check,
  ArrowRight,
  Focus,
  BadgePercent,
  Wallet,
  ReceiptText,
} from "lucide-react";
import type {
  Employee,
  Supplier,
  Sale,
  Movement,
  Payment,
  PayoutPreview,
} from "@/lib/types";
import { businessToday, commissionAmount, periodRange } from "@/lib/domain";
import { scanValue, isScanTerminator } from "@/lib/scanner";
import { DatePicker, Select, money, shortDate } from "./ui";

export const methodOptions = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
];
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
function useSubmit(write: Write, onDone: () => void) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef({ body: "", id: "" });
  async function submit(action: string, payload: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    const body = JSON.stringify({ action, payload });
    if (retry.current.body !== body)
      retry.current = { body, id: crypto.randomUUID() };
    try {
      await write(action, payload, retry.current.id);
      onDone();
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
  defaultRateBps = null,
  total = 0,
}: {
  employees: Employee[];
  value: {
    employeeId: string;
    mode: string;
    value: string;
    rememberRate?: boolean;
  } | null;
  defaultRateBps?: number | null;
  total?: number;
  onChange: (
    value: {
      employeeId: string;
      mode: string;
      value: string;
      rememberRate?: boolean;
    } | null,
  ) => void;
}) {
  let amount = 0;
  try {
    if (value) amount = commissionAmount(total, value.mode, value.value);
  } catch {
    /* Incomplete input while typing. */
  }
  return (
    <div className="commission-box">
      <label className="switch-label">
        <span>
          <strong>
            <BadgePercent size={22} /> Comisión de esta venta
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
                    mode: "percent",
                    value: defaultRateBps ? String(defaultRateBps / 100) : "",
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
          <div className="form-grid">
            <Select
              label="Tipo"
              value={value.mode}
              options={[
                { value: "fixed", label: "Monto fijo" },
                { value: "percent", label: "Porcentaje" },
              ]}
              onChange={(mode) =>
                onChange({
                  ...value,
                  mode,
                  rememberRate: mode === "percent" && value.rememberRate,
                })
              }
            />
            <label>
              {value.mode === "percent" ? "Porcentaje (%)" : "Comisión ($)"}
              <input
                inputMode="decimal"
                value={value.value}
                onChange={(event) =>
                  onChange({ ...value, value: event.target.value })
                }
                placeholder="0.00"
                required
              />
            </label>
          </div>
          {!employees.some((e) => e.active) && (
            <p className="hint wide">Agrega un empleado primero.</p>
          )}
          {value.mode === "percent" && (
            <label className="check-label wide">
              <input
                type="checkbox"
                checked={!!value.rememberRate}
                onChange={(event) =>
                  onChange({ ...value, rememberRate: event.target.checked })
                }
              />
              Usar este % en próximas ventas
            </label>
          )}
          <div className="commission-calculation wide">
            <span>Comisión a pagar</span>
            <strong className="number">{money(amount)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

export function MovementForm({
  kind,
  source,
  employees,
  suppliers,
  providerNames,
  defaultRateBps,
  write,
  onDone,
  onClose,
}: {
  kind: "entrada" | "salida";
  source?: Sale;
  employees: Employee[];
  suppliers: Supplier[];
  providerNames: string[];
  defaultRateBps: number | null;
  write: Write;
  onDone: () => void;
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
    mode: string;
    value: string;
    rememberRate?: boolean;
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
    void submit("movement.create", {
      kind,
      date: recordDate,
      paymentDate: partial
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
      received: partial ? received : (total / 100).toFixed(2),
      commission,
      source: source ? { kind: source.kind, id: source.id } : undefined,
    });
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
              <span>
                Subtotal {money(source.subtotalCents)} · IVA{" "}
                {money(source.taxCents)}
              </span>
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
            <div className="source-lines">
              {source.items.map((item, i) => (
                <div key={i}>
                  <span>
                    {item.quantity} × {item.description}
                    <small>{money(item.unitCents)} por unidad</small>
                  </span>
                  <strong className="number">{money(item.totalCents)}</strong>
                </div>
              ))}
            </div>
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
                  {kind === "entrada" ? "Cobrado ($)" : "Pagado ($)"}
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
          {kind === "entrada" && (
            <CommissionFields
              employees={employees}
              value={commission}
              onChange={setCommission}
              defaultRateBps={defaultRateBps}
              total={total}
            />
          )}
          <label>
            Nota <span className="optional">Opcional</span>
            <textarea name="notes" maxLength={2000} rows={2} />
          </label>
          <div className="form-total">
            <span>Total</span>
            <strong className="number">{money(total)}</strong>
          </div>
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

export function TicketLookup({ onSelect }: { onSelect: (sale: Sale) => void }) {
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
        !result.sales[0].registeredId
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
    <div className="modal-body form-stack">
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
              disabled={sale.cancelled || !!sale.registeredId}
              onClick={() => onSelect(sale)}
            >
              <div>
                <strong>{sale.folio}</strong>
                <small>
                  {sale.contact} · {shortDate(sale.date)} · Sistema{" "}
                  {sale.origin === "blanca" ? "blanco" : "negro"}
                </small>
                <span className="hint">
                  {sale.cancelled
                    ? "Ticket cancelado"
                    : sale.registeredId
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
  onDone: () => void;
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
    void submit(kind + ".save", {
      ...Object.fromEntries(f),
      id: initial?.id,
      category,
      method,
    });
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
  onDone: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(businessToday()),
    [method, setMethod] = useState(movement.method);
  const { busy, error, submit } = useSubmit(write, onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit("payment.create", {
          ...Object.fromEntries(new FormData(event.currentTarget)),
          movementId: movement.id,
          date,
          method,
        });
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

export function PreferenceForm({
  rateBps,
  write,
  onDone,
  onClose,
}: {
  rateBps: number | null;
  write: Write;
  onDone: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    rateBps === null ? "" : String(rateBps / 100),
  );
  const { busy, error, submit } = useSubmit(write, onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit("preferences.save", { rate: value.trim() ? value : null });
      }}
    >
      <div className="modal-body">
        <fieldset className="form-stack" disabled={busy}>
          <label>
            Porcentaje sugerido (%)
            <input
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Sin sugerencia"
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
      </div>
      <Footer busy={busy} onClose={onClose} label="Guardar preferencia" />
    </form>
  );
}

export function PayoutForm({
  employees,
  initialEmployeeId,
  initialPeriod,
  initialAnchor,
  write,
  onDone,
  onClose,
}: {
  employees: Employee[];
  initialEmployeeId?: string;
  initialPeriod: string;
  initialAnchor: string;
  write: Write;
  onDone: () => void;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId || ""),
    [period, setPeriod] = useState(initialPeriod),
    [anchor, setAnchor] = useState(initialAnchor),
    [paidOn, setPaidOn] = useState(businessToday());
  const [preview, setPreview] = useState<PayoutPreview | null>(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [revision, setRevision] = useState(0);
  const { busy, error, submit } = useSubmit(write, onDone);
  const range = periodRange(period, anchor);
  useEffect(() => {
    setPreview(null);
    setLoadError("");
    if (!employeeId) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      payout: "1",
      employeeId,
      period,
      anchor,
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
  }, [employeeId, period, anchor, revision]);
  const current =
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
        void submit("commission.batchPay", {
          employeeId,
          period,
          anchor,
          paidOn,
          commissionIds: current.commissions.map((c) => c.id),
          expectedTotalCents: current.totalCents,
        });
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
          <div className="form-grid">
            <Select
              label="Periodo"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "day", label: "Día" },
                { value: "week", label: "Semana" },
                { value: "month", label: "Mes" },
              ]}
            />
            <DatePicker
              label="Fecha del periodo"
              value={anchor}
              onChange={setAnchor}
            />
          </div>
          <div className="payout-summary">
            <Wallet size={30} />
            <div>
              <span>
                {shortDate(range.from)}
                {range.from !== range.to ? " — " + shortDate(range.to) : ""}
              </span>
              <strong className="number">
                {loading ? "…" : money(current?.totalCents || 0)}
              </strong>
              <small>
                {current?.commissions.length || 0} comisiones pendientes
              </small>
            </div>
          </div>
          {loading && <p role="status">Consultando comisiones…</p>}
          {current && (
            <div className="payout-lines">
              {current.commissions.map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{c.source_folio || c.concept}</strong>
                    <small>{shortDate(c.date)}</small>
                  </span>
                  <strong className="number">{money(c.amount_cents)}</strong>
                </div>
              ))}
              {!current.commissions.length && (
                <div className="empty compact">Todo pagado en este periodo</div>
              )}
            </div>
          )}
          {!!current?.commissions.length && (
            <DatePicker
              label="Fecha de pago"
              value={paidOn}
              onChange={setPaidOn}
            />
          )}
          {(error || loadError) && (
            <div className="error" role="alert">
              {error || loadError}
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
  onDone: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(businessToday());
  const { busy, error, submit } = useSubmit(write, onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(action, {
          id: entityId,
          date,
          ...Object.fromEntries(new FormData(event.currentTarget)),
        });
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
}: {
  movement: Movement;
  payments: Payment[];
  onPayment: () => void;
  onVoid: () => void;
}) {
  const inactive = movement.source_cancelled || !!movement.voided_at;
  return (
    <div className="modal-body form-stack">
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
          <h3>{movement.contact || movement.category}</h3>
          <p>{movement.concept}</p>
        </div>
        <strong className="number">{money(movement.total_cents)}</strong>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Origen</dt>
          <dd>
            {movement.source_folio
              ? `${movement.source_folio} · Sistema ${movement.source_origin === "blanca" ? "blanco" : "negro"}`
              : movement.manual_folio
                ? `${movement.manual_folio} · Registro manual${movement.manual_origin === "manual" ? "" : " · Sistema " + (movement.manual_origin === "blanca" ? "blanco" : "negro")}`
                : "Registro manual"}
          </dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{movement.category}</dd>
        </div>
        <div>
          <dt>Referencia</dt>
          <dd>{movement.reference || "Sin referencia"}</dd>
        </div>
        <div>
          <dt>Saldo pendiente</dt>
          <dd className="number">
            {inactive
              ? "No aplica"
              : money(movement.total_cents - movement.paid_cents)}
          </dd>
        </div>
        {movement.source_id && (
          <div className="wide">
            <dt>ID de venta</dt>
            <dd className="ticket-id">
              LLA1:{movement.source_kind === "ventas" ? "V" : "P"}:
              {movement.source_id}
            </dd>
          </div>
        )}
        {movement.manual_ticket_code && (
          <div className="wide">
            <dt>ID del ticket</dt>
            <dd className="ticket-id">{movement.manual_ticket_code}</dd>
          </div>
        )}
      </dl>
      <div className="source-lines">
        {movement.items.map((line, i) => (
          <div key={i}>
            <span>
              {line.quantity} × {line.description}
              <small>{money(line.unitCents)} por unidad</small>
            </span>
            <strong className="number">{money(line.totalCents)}</strong>
          </div>
        ))}
      </div>
      <div className="detail-tax">
        <span>Subtotal {money(movement.subtotal_cents)}</span>
        <span>IVA {money(movement.tax_cents)}</span>
      </div>
      {movement.commission_id && (
        <div className="commission-detail">
          <strong>Comisión · {movement.employee_name}</strong>
          <span>
            {money(movement.commission_cents || 0)} ·{" "}
            {movement.commission_paid_on
              ? `Pagada ${shortDate(movement.commission_paid_on)}`
              : "Pendiente de pago"}
          </span>
        </div>
      )}
      <div>
        <h3>
          {movement.kind === "entrada"
            ? "Cobros registrados"
            : "Pagos registrados"}
        </h3>
        {payments.length ? (
          <div className="payment-history">
            {payments.map((payment) => (
              <div key={payment.id}>
                <span>
                  {shortDate(payment.date)}
                  <small>
                    {payment.method}
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
          <p className="hint">Aún no hay abonos registrados.</p>
        )}
      </div>
      {movement.notes && (
        <div className="notes">
          <span className="eyebrow">NOTA ADICIONAL</span>
          <p>{movement.notes}</p>
        </div>
      )}
      {!inactive && (
        <div className="detail-actions">
          {movement.paid_cents < movement.total_cents && (
            <button className="button primary" onClick={onPayment}>
              {movement.kind === "entrada"
                ? "Registrar cobro"
                : "Registrar pago"}
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
