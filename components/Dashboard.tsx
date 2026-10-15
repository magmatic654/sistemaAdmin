"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  RefreshCw,
  ScanLine,
  Users,
  Wallet,
  X,
  ReceiptText,
  Banknote,
} from "lucide-react";
import type {
  AdminState,
  Employee,
  Movement,
  Payment,
  Sale,
} from "@/lib/types";
import { periodRange, type PeriodSelection } from "@/lib/domain";
import { parseSection, usesPeriod, type Section, type PeriodSection } from "@/lib/navigation";
import { Modal, Select, money, shortDate } from "./ui";
import PeriodControls from "./PeriodControls";
import {
  PayoutForm,
  ConfirmForm,
  DetailView,
  MasterForm,
  ManualSaleForm,
  MovementForm,
  PaymentForm,
  TicketLookup,
  FolioForm,
  type Write,
} from "./forms";

type Panel = "ventas" | "salidas" | "comisiones";
type Dialog = {
  type:
    | "entrada"
    | "salida"
    | "ticket"
    | "employee"
    | "detail"
    | "payment"
    | "payout"
    | "folio"
    | "void";
  source?: Sale;
  initial?: Employee;
  movement?: Movement;
  payments?: Payment[];
  id?: string;
};
const sections = [
  { id: "registro" as const, label: "Registro", icon: ClipboardList },
  { id: "ganancia" as const, label: "Ganancia", icon: Wallet },
  { id: "pagos" as const, label: "Pagos pendientes", icon: Banknote },
  { id: "historial" as const, label: "Historial", icon: ReceiptText },
  { id: "empleados" as const, label: "Empleados", icon: Users },
];
const panels = [
  { id: "ventas" as const, label: "Ventas" },
  { id: "salidas" as const, label: "Gastos" },
  { id: "comisiones" as const, label: "Comisiones" },
];

function printedFolio(value: string | null) {
  return value && !/^MAN-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function Status({ m }: { m: Movement }) {
  if (!m.voided_at && m.kind === "entrada" && m.review_status === "pending")
    return <span className="pill neutral">Sin folio</span>;
  return (
    <span
      className={
        "pill " +
        (m.voided_at
          ? "neutral"
          : m.paid_cents >= m.total_cents
            ? "success"
            : "pending")
      }
    >
      {m.voided_at
        ? "Anulado"
        : m.paid_cents >= m.total_cents
          ? m.kind === "entrada"
            ? "Confirmada"
            : "Pagado"
          : m.paid_cents
            ? "Parcial"
            : "Pendiente"}
    </span>
  );
}

export default function Dashboard({ today, initialSection = "registro" }: {
  today: string;
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection),
    [panel, setPanel] = useState<Panel>("ventas"),
    [payee, setPayee] = useState<"empleados" | "proveedores">("empleados");
  const initialPeriod: PeriodSelection = { period: "day", anchor: today, from: today, to: today };
  const [periods, setPeriods] = useState<Record<PeriodSection, PeriodSelection>>({
      ganancia: initialPeriod,
      historial: initialPeriod,
      empleados: initialPeriod,
    }),
    [page, setPage] = useState(1);
  const selection = periods[usesPeriod(section) ? section : "ganancia"];
  const [data, setData] = useState<AdminState | null>(null),
    [dataKey, setDataKey] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [writing, setWriting] = useState(false),
    [toast, setToast] = useState("");
  const [employeeId, setEmployeeId] = useState(""),
    [showDeleted, setShowDeleted] = useState(false);
  const range = useMemo(
    () =>
      periodRange(
        selection.period,
        selection.anchor,
        selection.from,
        selection.to,
      ),
    [selection],
  );
  const fetchId = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  let view = "entradas";
  if (section === "empleados") view = "comisiones";
  else if (section === "pagos")
    view = payee === "empleados" ? "comisiones-pendientes" : "proveedores";
  else if (section === "historial")
    view = { ventas: "entradas", salidas: "salidas", comisiones: "comisiones" }[panel];
  const globalView = section === "pagos";
  const queryRange = globalView
    ? { from: "2000-01-01", to: "2100-12-31" }
    : range;
  const queryKey = [view, queryRange.from, queryRange.to, page].join(":");
  useEffect(() => {
    const url = new URL(window.location.href);
    if (["resumen", "revision"].includes(url.searchParams.get("seccion") || "")) {
      url.searchParams.set("seccion", parseSection(url.searchParams.get("seccion")));
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    function restore() {
      setSection(parseSection(new URL(window.location.href).searchParams.get("seccion")));
      setPage(1);
      setDialog(null);
      window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const update = () => setRefresh((n) => n + 1);
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      id = ++fetchId.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      view,
      from: queryRange.from,
      to: queryRange.to,
      page: String(page),
    });
    void fetch("/api/admin?" + params, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        if (id === fetchId.current) {
          setData(result);
          setDataKey(queryKey);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError" && id === fetchId.current)
          setError(error.message);
      })
      .finally(() => {
        if (id === fetchId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [view, queryRange.from, queryRange.to, queryKey, page, refresh]);
  function navigate(value: Section) {
    setSection(value);
    setPage(1);
    setDialog(null);
    if (new URL(window.location.href).searchParams.get("seccion") !== value)
      window.history.pushState(null, "", "?seccion=" + value);
    window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }
  const write: Write = useCallback(async (action, payload, requestId) => {
    setWriting(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, requestId }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      return result;
    } finally {
      setWriting(false);
    }
  }, []);
  function saved(message = "Registro guardado") {
    setDialog(null);
    setRefresh((n) => n + 1);
    setToast(message);
    window.requestAnimationFrame(() =>
      noticeRef.current?.scrollIntoView({ block: "nearest" }),
    );
  }
  async function removeEmployee(employee: Employee) {
    try {
      await write(
        "employee.active",
        { id: employee.id, active: !employee.active },
        crypto.randomUUID(),
      );
      setEmployeeId("");
      setRefresh((n) => n + 1);
      setToast(employee.active ? "Empleado eliminado" : "Empleado restaurado");
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  async function detail(movement: Pick<Movement, "id">, folio = false) {
    try {
      const response = await fetch("/api/admin?detail=" + movement.id);
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setDialog({ ...result, type: folio ? "folio" : "detail" });
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  const summary = data?.summary;
  const employees = (data?.employees || []).filter((e) =>
    showDeleted ? !e.active : e.active,
  );
  const commissions = (data?.commissions || []).filter((c) => !c.voided_at);
  const selectedEmployee = data?.employees.find((e) => e.id === employeeId);

  function movementTable() {
    return (
      <div className="table-surface">
        <div className="table-scroll">
          <table
            className={
              "responsive-table movement-table" +
              (view === "proveedores" ? " balance-table" : "")
            }
            role="table"
          >
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Fecha
                </th>
                <th scope="col" role="columnheader">
                  {view === "proveedores" ? "Proveedor" : "Concepto"}
                </th>
                <th scope="col" role="columnheader">
                  Estado
                </th>
                <th scope="col" role="columnheader" className="align-right">
                  {view === "proveedores" ? "Pendiente" : "Importe"}
                </th>
                <th scope="col" role="columnheader" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data?.movements.map((m) => (
                <tr key={m.id} role="row">
                  <td role="cell" data-label="Fecha" className="mobile-wide">
                    {shortDate(m.date)}
                    {printedFolio(m.source_folio || m.manual_folio) && (
                      <small>Ticket {printedFolio(m.source_folio || m.manual_folio)}</small>
                    )}
                  </td>
                  <td
                    role="cell"
                    data-label={
                      view === "proveedores" ? "Proveedor" : "Concepto"
                    }
                    className="concept-cell mobile-wide"
                  >
                    <button className="row-link" onClick={() => void detail(m)}>
                      {view === "proveedores"
                        ? m.contact || m.concept
                        : m.kind === "entrada"
                          ? m.items[0]?.description || m.concept
                          : m.concept}
                    </button>
                    <small>
                      {view === "proveedores" ? m.concept : m.contact}
                      {m.kind === "entrada" && m.items.length > 1 && (
                        <span className="movement-more-items">
                          + {m.items.length - 1} artículo
                          {m.items.length > 2 ? "s" : ""}
                        </span>
                      )}
                    </small>
                  </td>
                  <td role="cell" data-label="Estado">
                    <Status m={m} />
                  </td>
                  <td
                    role="cell"
                    data-label={
                      view === "proveedores" ? "Pendiente" : "Importe"
                    }
                    className={
                      "number align-right " + (m.voided_at ? "muted" : "")
                    }
                  >
                    {money(
                      view === "proveedores"
                        ? m.total_cents - m.paid_cents
                        : m.total_cents,
                    )}
                  </td>
                  <td
                    role="cell"
                    data-label="Acciones"
                    aria-label="Acciones"
                    className="align-right mobile-wide"
                  >
                    {view === "proveedores" ? (
                      <button
                        className="button secondary small"
                        onClick={() =>
                          setDialog({ type: "payment", movement: m })
                        }
                      >
                        Pagar
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        aria-label={
                          "Ver " + (m.items[0]?.description || m.concept)
                        }
                        onClick={() => void detail(m)}
                      >
                        <span className="mobile-action-label">Ver detalle</span>
                        <ChevronRight size={22} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data?.movements.length && <div className="empty">Sin registros</div>}
        {pageControls()}
      </div>
    );
  }

  function pageControls() {
    return (
      !!data?.total && (
        <div className="pagination">
          <span>
            {(page - 1) * data.pageSize + 1}–
            {Math.min(page * data.pageSize, data.total)} de {data.total}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Página anterior"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              className="icon-button"
              aria-label="Página siguiente"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
      )
    );
  }

  function employeePayables() {
    const balances = new Map<string, { name: string; amount: number; count: number }>();
    for (const commission of commissions) {
      if (
        commission.paid_on || commission.source_cancelled ||
        (commission.review_status !== "approved" && commission.review_status !== "validated")
      ) continue;
      const balance = balances.get(commission.employee_id) || {
        name: commission.employee_name, amount: 0, count: 0,
      };
      balance.amount += commission.amount_cents;
      balance.count += 1;
      balances.set(commission.employee_id, balance);
    }
    return (
      <div className="employee-payment-list">
        {[...balances].sort((a, b) => a[1].name.localeCompare(b[1].name, "es")).map(([id, balance]) => (
          <article className="employee-payment-row" key={id}>
            <div>
              <h3>{balance.name}</h3>
              <p>{balance.count} {balance.count === 1 ? "comisión" : "comisiones"}</p>
            </div>
            <strong className="number">{money(balance.amount)}</strong>
            <button className="button primary" disabled={loading} aria-label={`Pagar a ${balance.name}`}
              onClick={() => setDialog({ type: "payout", id })}>
              Pagar
            </button>
          </article>
        ))}
        {!balances.size && <div className="empty">Sin comisiones por pagar</div>}
      </div>
    );
  }

  function commissionTable(filterId?: string) {
    const rows = commissions.filter(
      (c) => !filterId || c.employee_id === filterId,
    );
    return (
      <div className="table-surface">
        <div className="table-scroll">
          <table className="responsive-table commission-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Empleado / fecha
                </th>
                <th scope="col" role="columnheader">
                  Venta
                </th>
                <th scope="col" role="columnheader" className="align-right">
                  Comisión
                </th>
                <th scope="col" role="columnheader">
                  Estado
                </th>
                <th scope="col" role="columnheader" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((c) => (
                <tr key={c.id} role="row">
                  <td
                    role="cell"
                    data-label="Empleado / fecha"
                    className="mobile-wide"
                  >
                    <strong>{c.employee_name}</strong>
                    <small>{shortDate(c.date)}</small>
                  </td>
                  <td
                    role="cell"
                    data-label="Venta"
                    className="concept-cell mobile-wide"
                  >
                    <strong>{c.concept}</strong>
                    {c.contact && <small>{c.contact}</small>}
                    {printedFolio(c.source_folio) && (
                      <small>Ticket {c.source_folio}</small>
                    )}
                  </td>
                  <td
                    role="cell"
                    data-label="Comisión"
                    className="number align-right"
                  >
                    {money(c.amount_cents)}
                  </td>
                  <td role="cell" data-label="Estado">
                    <span
                      className={
                        "pill " +
                        (c.paid_on
                          ? "success"
                          : c.review_status === "pending"
                            ? "neutral"
                            : "pending")
                      }
                    >
                      {c.paid_on ? (
                        "Pagada"
                      ) : c.review_status === "pending" ? (
                        "Sin folio"
                      ) : (
                        "Pendiente"
                      )}
                    </span>
                  </td>
                  <td
                    role="cell"
                    data-label="Acciones"
                    aria-label="Acciones"
                    className="mobile-wide"
                  >
                    {!c.paid_on && c.review_status === "pending" && (
                      <button
                        className="text-button"
                        onClick={() => void detail({ id: c.movement_id }, true)}
                      >
                        Completar folio
                      </button>
                    )}
                    {!c.paid_on && c.review_status !== "pending" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({ type: "payout", id: c.employee_id })
                        }
                      >
                        Liquidar empleado
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="empty">Sin comisiones</div>}
      </div>
    );
  }

  const title = dialog
    ? {
        entrada: dialog.source ? "Nueva venta" : "Registrar nueva venta",
        salida: "Nueva salida",
        ticket: "Escanear ticket",
        employee: dialog.initial ? "Editar empleado" : "Nuevo empleado",
        detail: "Detalle",
        payment: "Registrar pago",
        payout: "Liquidar comisiones",
        folio: "Completar folio",
        void: "Anular registro",
      }[dialog.type]
    : "";
  return (
    <div className="application direct-navigation">
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-mark">
            <ReceiptText size={25} />
          </span>
          <span>
            <small>LLANTERA</small>Administración
          </span>
        </div>
        <nav aria-label="Secciones">
          {sections.map((item) => (
            <a
              key={item.id}
              href={"?seccion=" + item.id}
              className={section === item.id ? "active" : ""}
              aria-current={section === item.id ? "page" : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigate(item.id);
              }}
            >
              <item.icon size={23} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <button
          className={"icon-button " + (loading ? "refreshing" : "")}
          aria-label="Actualizar"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={22} />
        </button>
      </header>
      <main className="main-content">
        <div className="page-heading">
          <h1 ref={headingRef} tabIndex={-1}>
            {sections.find((item) => item.id === section)!.label}
          </h1>
          {section === "empleados" && (
            <div className="heading-actions">
              <button
                className="button primary"
                onClick={() => setDialog({ type: "employee" })}
              >
                <Plus size={22} />
                Agregar empleado
              </button>
            </div>
          )}
          {section === "registro" && (
            <span className="date-stamp">{shortDate(today)}</span>
          )}
        </div>
        {toast && (
          <div className="save-notice" role="status" ref={noticeRef}>
            <Check size={22} aria-hidden="true" />
            <span>{toast}</span>
            <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToast("")}>
              <X size={22} />
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() => setRefresh((n) => n + 1)}
            >
              Reintentar
            </button>
          </div>
        )}
        {section === "registro" && (
          <div className="registration-actions">
            <button
              className="registration-card income-card"
              disabled={!data}
              onClick={() => setDialog({ type: "entrada" })}
            >
              <span className="action-icon">
                <ArrowDownLeft size={38} />
              </span>
              <span>
                <small>ENTRADAS</small>Nueva venta
              </span>
              <ArrowUpRight size={26} />
            </button>
            <button
              className="registration-card expense-card"
              disabled={!data}
              onClick={() => setDialog({ type: "salida" })}
            >
              <span className="action-icon">
                <ArrowUpRight size={38} />
              </span>
              <span>
                <small>SALIDAS</small>Nuevo gasto
              </span>
              <Plus size={26} />
            </button>
            <button
              className="registration-card scan-card"
              disabled={!data}
              onClick={() => setDialog({ type: "ticket" })}
            >
              <span className="scan-symbol">
                <ScanLine size={40} />
              </span>
              <span>
                Escanear ticket<small>Escanear · Confirmar</small>
              </span>
              <ChevronRight size={24} />
            </button>
          </div>
        )}
        {(section === "historial" || section === "pagos") && (
          <div className="workspace-filters">
            {section === "historial" && (
              <Select
                label="Tipo de registro"
                value={panel}
                onChange={(value) => {
                  setPanel(value as Panel);
                  setPage(1);
                }}
                options={panels.map((item) => ({ value: item.id, label: item.label }))}
              />
            )}
            {section === "pagos" && (
              <Select
                label="Pagar a"
                value={payee}
                onChange={(value) => {
                  setPayee(value as typeof payee);
                  setPage(1);
                }}
                options={[
                  { value: "empleados", label: "Empleados" },
                  { value: "proveedores", label: "Proveedores" },
                ]}
              />
            )}
          </div>
        )}
        {usesPeriod(section) && (
          <PeriodControls
            value={selection}
            today={today}
            onChange={(value) => {
              setPeriods((current) => ({ ...current, [section]: value }));
              setPage(1);
            }}
          />
        )}
        {!data || dataKey !== queryKey ? (
          <div className="loading-state" role="status">
            Cargando…
          </div>
        ) : (
          data && (
            <div
              className={loading || error ? "data-loading" : ""}
              aria-busy={loading}
            >
                  {section === "ganancia" && (
                    <>
                  <section
                    className="profit-section"
                    aria-label="Cálculo de ganancia del periodo"
                  >
                    <div className="summary-grid profit-grid">
                      <div
                        className={
                          "summary-card gain" +
                          (summary!.profit < 0 ? " is-loss" : "") +
                          (summary!.profit === 0 ? " is-zero" : "") +
                          (money(summary!.profit).length > 13
                            ? " is-long-amount"
                            : "")
                        }
                      >
                        <div className="summary-term-heading">
                          <span>Ganancia</span>
                        </div>
                        <strong
                          className={
                            "number " + (summary!.profit < 0 ? "danger" : "")
                          }
                        >
                          {money(summary!.profit)}
                        </strong>
                      </div>
                      <div
                        className="profit-details"
                        role="group"
                        aria-label="Detalle de la ganancia"
                      >
                        <div className={"summary-card collected" + (summary!.income === 0 ? " is-zero" : "")}>
                          <div className="summary-term-heading">
                            <span>Total de ventas</span>
                          </div>
                          <strong className="number">
                            {money(summary!.income)}
                          </strong>
                        </div>
                        <div className={"summary-card expense-total" + (summary!.expenses === 0 ? " is-zero" : "")}>
                          <div className="summary-term-heading">
                            <span>Gastos del periodo</span>
                          </div>
                          <strong className="number">
                            {money(summary!.expenses)}
                          </strong>
                        </div>
                        <div className={"summary-card commission-total" + (summary!.commissions === 0 ? " is-zero" : "")}>
                          <div className="summary-term-heading">
                            <span>Comisiones de estas ventas</span>
                          </div>
                          <strong className="number">
                            {money(summary!.commissions)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </section>
                    </>
                  )}
                  {section === "historial" && (
                    <section aria-label="Historial del periodo">
                      {panel === "comisiones" ? commissionTable() : movementTable()}
                    </section>
                  )}
                  {section === "pagos" && (
                    <section className="payments-workspace" aria-label="Pagos pendientes de todas las fechas">
                      <div className="payment-heading">
                        <div>
                          <h2>{payee === "empleados" ? "Falta pagar a empleados" : "Falta pagar a proveedores"}</h2>
                          <p>Todas las fechas</p>
                        </div>
                        <strong className="number">{money(payee === "empleados" ? summary!.employeePayable : summary!.payable)}</strong>
                      </div>
                      {payee === "empleados" ? employeePayables() : movementTable()}
                    </section>
                  )}
              {section === "empleados" && (
                <>
                  <div className="employee-toolbar">
                    <button
                      className="button primary payout-button"
                      disabled={!data.employees.length}
                      onClick={() =>
                        setDialog({ type: "payout", id: employeeId })
                      }
                    >
                      <Banknote size={22} />
                      Pagar comisiones
                    </button>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={showDeleted}
                        onChange={(event) => {
                          setShowDeleted(event.target.checked);
                          setEmployeeId("");
                        }}
                      />
                      Eliminados
                    </label>
                  </div>
                  <div className="table-surface">
                    <div className="table-scroll">
                      <table
                        className="responsive-table employee-table"
                        role="table"
                      >
                        <thead role="rowgroup">
                          <tr role="row">
                            <th scope="col" role="columnheader">
                              Empleado
                            </th>
                            <th
                              scope="col"
                              role="columnheader"
                              className="align-right"
                            >
                              Por pagar
                            </th>
                            <th
                              scope="col"
                              role="columnheader"
                              className="align-right"
                            >
                              Pagadas
                            </th>
                            <th
                              scope="col"
                              role="columnheader"
                              aria-label="Acciones"
                            />
                          </tr>
                        </thead>
                        <tbody role="rowgroup">
                          {employees.map((employee) => {
                            const rows = commissions.filter(
                                (c) => c.employee_id === employee.id,
                              ),
                              payable = rows
                                .filter(
                                  (c) =>
                                    !c.paid_on &&
                                    (c.review_status === "approved" ||
                                      c.review_status === "validated"),
                                )
                                .reduce((sum, c) => sum + c.amount_cents, 0),
                              paid = rows
                                .filter((c) => c.paid_on)
                                .reduce((sum, c) => sum + c.amount_cents, 0);
                            return (
                              <tr
                                key={employee.id}
                                role="row"
                                className={
                                  employeeId === employee.id
                                    ? "selected-row"
                                    : ""
                                }
                              >
                                <td
                                  role="cell"
                                  data-label="Empleado"
                                  className="mobile-wide"
                                >
                                  <button
                                    className="row-link employee-name"
                                    onClick={() =>
                                      setEmployeeId(
                                        employeeId === employee.id
                                          ? ""
                                          : employee.id,
                                      )
                                    }
                                  >
                                    {employee.name}
                                  </button>
                                  {employee.position && (
                                    <small>{employee.position}</small>
                                  )}
                                </td>
                                <td
                                  role="cell"
                                  data-label="Por pagar"
                                  className="number align-right"
                                >
                                  {money(payable)}
                                </td>
                                <td
                                  role="cell"
                                  data-label="Pagadas"
                                  className="number align-right"
                                >
                                  {money(paid)}
                                </td>
                                <td
                                  role="cell"
                                  data-label="Acciones"
                                  aria-label="Acciones"
                                  className="mobile-wide"
                                >
                                  <div className="row-actions">
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        setDialog({
                                          type: "employee",
                                          initial: employee,
                                        })
                                      }
                                    >
                                      Editar
                                    </button>
                                    <button
                                      className="text-button danger"
                                      disabled={writing}
                                      onClick={() =>
                                        void removeEmployee(employee)
                                      }
                                    >
                                      {employee.active
                                        ? "Eliminar"
                                        : "Restaurar"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!employees.length && (
                      <div className="empty">Sin empleados</div>
                    )}
                  </div>
                  {selectedEmployee && (
                    <section className="employee-detail">
                      <div className="employee-detail-heading">
                        <h2>{selectedEmployee.name}</h2>
                        <button className="text-button" onClick={() => setEmployeeId("")}>Cerrar detalle</button>
                      </div>
                      {commissionTable(selectedEmployee.id)}
                    </section>
                  )}
                </>
              )}
            </div>
          )
        )}
      </main>
      {dialog && data && (
        <Modal
          title={title}
          onClose={() => {
            if (!writing) setDialog(null);
          }}
          busy={writing}
          compactSale={dialog.type === "entrada" && !dialog.source}
        >
          {dialog.type === "entrada" && !dialog.source && (
            <ManualSaleForm
              employees={data.employees}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {(dialog.type === "salida" ||
            (dialog.type === "entrada" && dialog.source)) && (
            <MovementForm
              kind={dialog.type}
              source={dialog.source}
              employees={data.employees}
              suppliers={data.suppliers}
              providerNames={[]}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog.type === "ticket" && (
            <TicketLookup
              onSelect={(source) => setDialog({ type: "entrada", source })}
            />
          )}
          {dialog.type === "employee" && (
            <MasterForm
              kind="employee"
              initial={dialog.initial}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog.type === "detail" && dialog.movement && (
            <DetailView
              movement={dialog.movement}
              payments={dialog.payments || []}
              onPayment={() => setDialog({ ...dialog, type: "payment" })}
              onVoid={() =>
                setDialog({ ...dialog, type: "void", id: dialog.movement!.id })
              }
              onFolio={() => setDialog({ ...dialog, type: "folio" })}
            />
          )}
          {dialog.type === "folio" && dialog.movement && (
            <FolioForm
              movement={dialog.movement}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog.type === "payment" && dialog.movement && (
            <PaymentForm
              movement={dialog.movement}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog.type === "payout" && (
            <PayoutForm
              employees={data.employees}
              initialEmployeeId={dialog.id}
              initialPeriod="all"
              initialAnchor={today}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog.type === "void" && (
            <ConfirmForm
              action="movement.void"
              entityId={dialog.id!}
              write={write}
              onDone={saved}
              onClose={() => setDialog(null)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
