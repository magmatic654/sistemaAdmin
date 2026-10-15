"use client";
import { useRef, useState, type FormEvent } from "react";
import { Plus, ScanLine, Trash2, Check, ArrowRight } from "lucide-react";
import type { Employee, Supplier, Sale, Movement, Payment } from "@/lib/types";
import { businessToday } from "@/lib/domain";
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
}: {
  busy: boolean;
  onClose: () => void;
  label: string;
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
      <button className="button primary" disabled={busy}>
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
}: {
  employees: Employee[];
  value: { employeeId: string; mode: string; value: string } | null;
  onChange: (
    value: { employeeId: string; mode: string; value: string } | null,
  ) => void;
}) {
  return (
    <div className="commission-box">
      <label className="switch-label">
        <span>
          <strong>Comisión</strong>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={value !== null}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { employeeId: "", mode: "fixed", value: "" }
                : null,
            )
          }
        />
      </label>
      {value && (
        <div className="form-grid">
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
              onChange={(mode) => onChange({ ...value, mode })}
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
  const [commission, setCommission] = useState<{
    employeeId: string;
    mode: string;
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
    void submit("movement.create", {
      kind,
      date: recordDate,
      paymentDate: partial
        ? paymentDate < recordDate
          ? recordDate
          : paymentDate
        : recordDate,
      contact,
      phone: source?.phone || "",
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
    <form onSubmit={save}>
      <fieldset disabled={busy} className="modal-body form-stack">
        {kind === "entrada" && !source && (
          <label>
            ID o folio del ticket
            <input
              name="ticketCode"
              placeholder="ID, folio o código de barras"
              maxLength={100}
              required
            />
          </label>
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
                : ["Venta de productos", "Venta de servicios", "Otros ingresos"]
              ).map((value) => ({ value, label: value }))}
            />
          )}
        </div>
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
      <Footer busy={busy} onClose={onClose} label="Guardar" />
    </form>
  );
}

export function TicketLookup({ onSelect }: { onSelect: (sale: Sale) => void }) {
  const [code, setCode] = useState(""),
    [sales, setSales] = useState<Sale[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function lookup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSales(null);
    try {
      const response = await fetch(
        "/api/admin?ticket=" + encodeURIComponent(code.trim()),
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
    }
  }
  return (
    <div className="modal-body form-stack">
      <form onSubmit={lookup} className="scan-form">
        <label>
          Código o folio
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Escanea o escribe aquí"
            autoFocus
            required
            maxLength={100}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Buscando…" : "Cargar"}
          <ArrowRight size={19} />
        </button>
      </form>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {sales?.length === 0 && (
        <div className="empty compact">
          <strong>No encontramos ese ticket</strong>
          <p>Comprueba el folio. Puedes consultar tickets de ambos sistemas.</p>
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
      <fieldset className="modal-body form-stack" disabled={busy}>
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
      <fieldset className="modal-body form-stack" disabled={busy}>
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
          <DatePicker label="Fecha del abono" value={date} onChange={setDate} />
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
      <Footer busy={busy} onClose={onClose} label="Guardar" />
    </form>
  );
}

export function CommissionForm({
  movement,
  employees,
  write,
  onDone,
  onClose,
}: {
  movement: Movement;
  employees: Employee[];
  write: Write;
  onDone: () => void;
  onClose: () => void;
}) {
  const [commission, setCommission] = useState<{
    employeeId: string;
    mode: string;
    value: string;
  } | null>({ employeeId: "", mode: "fixed", value: "" });
  const { busy, error, submit } = useSubmit(write, onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (commission)
          void submit("commission.create", {
            movementId: movement.id,
            commission,
          });
      }}
    >
      <fieldset className="modal-body form-stack" disabled={busy}>
        <div className="form-total">
          <span>Total de la entrada</span>
          <strong className="number">{money(movement.total_cents)}</strong>
        </div>
        <CommissionFields
          employees={employees}
          value={commission}
          onChange={setCommission}
        />
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </fieldset>
      <Footer
        busy={busy || !commission}
        onClose={onClose}
        label="Guardar comisión"
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
      <fieldset className="modal-body form-stack" disabled={busy}>
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
  onCommission,
  onVoid,
}: {
  movement: Movement;
  payments: Payment[];
  onPayment: () => void;
  onCommission: () => void;
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
          {movement.kind === "entrada" && !movement.commission_id && (
            <button className="button secondary" onClick={onCommission}>
              Agregar comisión
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
