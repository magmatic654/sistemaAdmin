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
  ClipboardCheck,
  LockKeyhole,
} from "lucide-react";
import type {
  AdminState,
  Employee,
  Movement,
  Payment,
  Sale,
} from "@/lib/types";
import { periodRange, type PeriodSelection } from "@/lib/domain";
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
  SaleReviewForm,
  methodOptions,
  type Write,
} from "./forms";

type Section = "registro" | "resumen" | "empleados";
type Panel = "ventas" | "salidas" | "proveedores" | "comisiones" | "revision";
type Dialog = {
  type:
    | "entrada"
    | "salida"
    | "ticket"
    | "employee"
    | "detail"
    | "payment"
    | "payout"
    | "review"
    | "void";
  source?: Sale;
  initial?: Employee;
  movement?: Movement;
  payments?: Payment[];
  id?: string;
};
const sections = [
  { id: "registro" as const, label: "Registro", icon: ClipboardList },
  { id: "resumen" as const, label: "Resumen", icon: Wallet },
  { id: "empleados" as const, label: "Empleados", icon: Users },
];
const panels = [
  { id: "ventas" as const, label: "Ventas" },
  { id: "salidas" as const, label: "Gastos" },
  { id: "proveedores" as const, label: "Proveedores" },
  { id: "comisiones" as const, label: "Comisiones" },
  { id: "revision" as const, label: "Por revisar" },
];

function Status({ m }: { m: Movement }) {
  if (!m.voided_at && m.kind === "entrada" && m.review_status === "pending")
    return <span className="pill review-pill">Requiere revisión</span>;
  if (!m.voided_at && m.review_status === "approved")
    return <span className="pill manual-approved">Manual aprobada</span>;
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

export default function Dashboard({ today }: { today: string }) {
  const [section, setSection] = useState<Section>("registro"),
    [panel, setPanel] = useState<Panel>("ventas");
  const [selection, setSelection] = useState<PeriodSelection>({
      period: "day",
      anchor: today,
      from: today,
      to: today,
    }),
    [page, setPage] = useState(1);
  const [data, setData] = useState<AdminState | null>(null),
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
  const historyRef = useRef<HTMLHeadingElement>(null);
  const view =
    section === "empleados"
      ? "comisiones"
      : panel === "ventas"
        ? "entradas"
        : panel === "revision"
          ? "revision"
          : panel === "salidas"
            ? "salidas"
            : panel === "comisiones"
              ? "comisiones-pendientes"
              : "proveedores";
  useEffect(() => {
    const value = new URL(window.location.href).searchParams.get("seccion");
    if (value === "resumen" || value === "empleados") setSection(value);
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController(),
      id = ++fetchId.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      view,
      from: range.from,
      to: range.to,
      page: String(page),
    });
    void fetch("/api/admin?" + params, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        if (id === fetchId.current) setData(result);
      })
      .catch((error) => {
        if (error.name !== "AbortError" && id === fetchId.current)
          setError(error.message);
      })
      .finally(() => {
        if (id === fetchId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [view, range.from, range.to, page, refresh]);
  function navigate(value: Section) {
    setSection(value);
    setPage(1);
    window.history.replaceState(null, "", "?seccion=" + value);
  }
  function choosePanel(value: Panel, reveal = false) {
    setPanel(value);
    setPage(1);
    if (reveal) {
      window.requestAnimationFrame(() => {
        historyRef.current?.focus({ preventScroll: true });
        historyRef.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      });
    }
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
  function saved() {
    setDialog(null);
    setRefresh((n) => n + 1);
    setToast("Guardado");
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
  async function detail(movement: Pick<Movement, "id">, review = false) {
    try {
      const response = await fetch("/api/admin?detail=" + movement.id);
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setDialog({ ...result, type: review ? "review" : "detail" });
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
              (panel === "proveedores" ? " balance-table" : "")
            }
            role="table"
          >
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Fecha
                </th>
                <th scope="col" role="columnheader">
                  {panel === "proveedores" ? "Proveedor" : "Concepto"}
                </th>
                <th scope="col" role="columnheader">
                  Estado
                </th>
                <th scope="col" role="columnheader" className="align-right">
                  {panel === "proveedores" ? "Pendiente" : "Importe"}
                </th>
                <th scope="col" role="columnheader" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data?.movements.map((m) => (
                <tr key={m.id} role="row">
                  <td role="cell" data-label="Fecha" className="mobile-wide">
                    {shortDate(m.date)}
                    {m.source_folio && <small>Ticket {m.source_folio}</small>}
                  </td>
                  <td
                    role="cell"
                    data-label={
                      panel === "proveedores" ? "Proveedor" : "Concepto"
                    }
                    className="concept-cell mobile-wide"
                  >
                    <button className="row-link" onClick={() => void detail(m)}>
                      {panel === "proveedores"
                        ? m.contact || m.concept
                        : m.kind === "entrada"
                          ? m.items[0]?.description || m.concept
                          : m.concept}
                    </button>
                    <small>
                      {panel === "proveedores" ? m.concept : m.contact}
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
                      panel === "proveedores" ? "Pendiente" : "Importe"
                    }
                    className={
                      "number align-right " + (m.voided_at ? "muted" : "")
                    }
                  >
                    {money(
                      panel === "proveedores"
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
                    {panel === "proveedores" ? (
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

  function reviewList() {
    return (
      <section
        className="review-queue"
        aria-label="Ventas por revisar de todas las fechas"
      >
        <div className="review-queue-heading">
          <div>
            <h2>Ventas por revisar</h2>
            <p>
              {data!.reviewCount} {data!.reviewCount === 1 ? "venta" : "ventas"}{" "}
              · Todas las fechas
            </p>
          </div>
          <strong className="number">{money(data!.reviewTotal)}</strong>
        </div>
        <div className="review-sales-list">
          {data?.movements.map((m) => {
            const lines = m.items.length
              ? m.items
              : [
                  {
                    description: m.concept,
                    quantity: 1,
                    unitCents: m.total_cents,
                    totalCents: m.total_cents,
                  },
                ];
            const renderLine = (
              line: Movement["items"][number],
              index: number,
            ) => (
              <li key={index}>
                <h3>{line.description}</h3>
                <div className="review-line-prices">
                  <span>
                    {line.quantity} × {money(line.unitCents)}
                  </span>
                  <strong className="number">{money(line.totalCents)}</strong>
                </div>
              </li>
            );
            return (
              <article className="review-sale-card" key={m.id}>
                <div className="review-sale-topline">
                  <span className="pill review-pill">Requiere revisión</span>
                  <time dateTime={m.date}>{shortDate(m.date)}</time>
                </div>
                <ul className="review-sale-items">
                  {lines.slice(0, 3).map(renderLine)}
                </ul>
                {lines.length > 3 && (
                  <details className="review-extra-items">
                    <summary>Ver {lines.length - 3} artículos más</summary>
                    <ul className="review-sale-items">
                      {lines.slice(3).map(renderLine)}
                    </ul>
                  </details>
                )}
                <dl className="review-sale-facts">
                  <div>
                    <dt>Cliente</dt>
                    <dd>{m.contact || "Público general"}</dd>
                  </div>
                  <div>
                    <dt>Forma de pago</dt>
                    <dd>
                      {methodOptions.find((option) => option.value === m.method)
                        ?.label || m.method}
                    </dd>
                  </div>
                  {m.commission_cents ? (
                    <div className="review-commission-fact">
                      <dt>Comisión congelada</dt>
                      <dd>
                        {m.employee_name}
                        <strong className="number">
                          {money(m.commission_cents)}
                        </strong>
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt>Comisión</dt>
                      <dd>Sin comisión</dd>
                    </div>
                  )}
                </dl>
                <div className="review-sale-footer">
                  <div>
                    <span>Total de la venta</span>
                    <strong className="number">{money(m.total_cents)}</strong>
                  </div>
                  <button
                    className="button secondary review-action"
                    onClick={() => void detail(m, true)}
                  >
                    Revisar venta
                    <ChevronRight size={21} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!data?.movements.length && (
          <div className="empty">No hay ventas por revisar</div>
        )}
        {pageControls()}
      </section>
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
                    {c.source_folio && !c.source_folio.startsWith("MAN-") && (
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
                            ? "frozen-pill"
                            : "pending")
                      }
                    >
                      {c.paid_on ? (
                        "Pagada"
                      ) : c.review_status === "pending" ? (
                        <>
                          <LockKeyhole size={13} /> Congelada
                        </>
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
                        Revisar venta
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
        review: "Revisar venta",
        void: "Anular registro",
      }[dialog.type]
    : "";
  return (
    <div className="application">
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
            <button
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={23} />
              <span>{item.label}</span>
            </button>
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
          <h1>
            {section === "registro"
              ? "Registro"
              : section === "resumen"
                ? "Resumen"
                : "Gestión de empleados"}
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
          {section === "registro" && !!data?.reviewCount && (
            <button
              className="review-shortcut"
              onClick={() => {
                navigate("resumen");
                choosePanel("revision", true);
              }}
            >
              <ClipboardCheck size={19} />
              Por revisar <strong>{data.reviewCount}</strong>
            </button>
          )}
        </div>
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
                Escanear ticket<small>Escanear · Revisar · Confirmar</small>
              </span>
              <ChevronRight size={24} />
            </button>
            <div className="registration-links">
              <button
                className="text-button"
                onClick={() => navigate("resumen")}
              >
                <ReceiptText size={21} />
                Ver movimientos
                <ChevronRight size={18} />
              </button>
              <button
                className="text-button"
                disabled={!data}
                onClick={() => setDialog({ type: "payout" })}
              >
                <Banknote size={22} />
                Liquidar comisiones
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
        {section !== "registro" && (
          <PeriodControls
            value={selection}
            onChange={(value) => {
              setSelection(value);
              setPage(1);
            }}
          />
        )}
        {loading && !data ? (
          <div className="loading-state" role="status">
            Cargando…
          </div>
        ) : (
          data && (
            <div
              className={loading || error ? "data-loading" : ""}
              aria-busy={loading}
            >
              {section === "resumen" && (
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
                          <span className="calculation-mark" aria-hidden="true">
                            =
                          </span>
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
                        <div className="summary-card collected">
                          <div className="summary-term-heading">
                            <span
                              className="calculation-mark"
                              aria-hidden="true"
                            >
                              +
                            </span>
                            <span>Total de ventas</span>
                          </div>
                          <strong className="number">
                            {money(summary!.income)}
                          </strong>
                        </div>
                        <div className="summary-card expense-total">
                          <div className="summary-term-heading">
                            <span
                              className="calculation-mark"
                              aria-hidden="true"
                            >
                              −
                            </span>
                            <span>Gastos del periodo</span>
                          </div>
                          <strong className="number">
                            {money(summary!.expenses)}
                          </strong>
                        </div>
                        <div className="summary-card commission-total">
                          <div className="summary-term-heading">
                            <span
                              className="calculation-mark"
                              aria-hidden="true"
                            >
                              −
                            </span>
                            <span>Comisiones confirmadas</span>
                          </div>
                          <strong className="number">
                            {money(summary!.commissions)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </section>
                  {summary!.pendingSalesCount > 0 && (
                    <section
                      className="review-period-summary"
                      aria-label="Ventas por revisar del periodo"
                    >
                      <div className="review-period-copy">
                        <span>Ventas por revisar</span>
                        <strong className="number">
                          {money(summary!.pendingIncome)}
                        </strong>
                        <small>
                          {summary!.pendingSalesCount}{" "}
                          {summary!.pendingSalesCount === 1
                            ? "venta del periodo"
                            : "ventas del periodo"}{" "}
                          · Sin afectar la ganancia
                        </small>
                        {summary!.pendingCommissions > 0 && (
                          <small>
                            Comisiones en espera:{" "}
                            <b>{money(summary!.pendingCommissions)}</b>
                          </small>
                        )}
                      </div>
                      {!!data.reviewCount && (
                        <button
                          className="button secondary review-action"
                          onClick={() => choosePanel("revision", true)}
                        >
                          Revisar ventas
                          <ChevronRight size={21} aria-hidden="true" />
                        </button>
                      )}
                    </section>
                  )}
                  <section
                    className="pending-section"
                    aria-label="Saldos pendientes de todas las fechas"
                  >
                    <div className="pending-heading">
                      <h2>Por pagar</h2>
                      <span>Todas las fechas</span>
                    </div>
                    <div className="pending-grid">
                      <button
                        className="summary-card supplier-due"
                        aria-label={
                          "Por pagar a proveedores: " + money(summary!.payable)
                        }
                        onClick={() => choosePanel("proveedores", true)}
                      >
                        <div className="pending-card-content">
                          <span>Proveedores</span>
                          <strong className="number">
                            {money(summary!.payable)}
                          </strong>
                        </div>
                        <ChevronRight size={23} aria-hidden="true" />
                      </button>
                      <button
                        className="summary-card employee-due"
                        aria-label={
                          "Comisiones por pagar: " +
                          money(summary!.employeePayable)
                        }
                        onClick={() => choosePanel("comisiones", true)}
                      >
                        <div className="pending-card-content">
                          <span>Comisiones autorizadas</span>
                          <strong className="number">
                            {money(summary!.employeePayable)}
                          </strong>
                        </div>
                        <ChevronRight size={23} aria-hidden="true" />
                      </button>
                    </div>
                  </section>
                  <div className="history-header">
                    <h2
                      className="history-title"
                      tabIndex={-1}
                      ref={historyRef}
                    >
                      Historial
                    </h2>
                    <div className="history-tabs">
                      {panels.map((item) => (
                        <button
                          key={item.id}
                          className={panel === item.id ? "active" : ""}
                          onClick={() => choosePanel(item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {panel === "revision"
                    ? reviewList()
                    : panel === "comisiones"
                      ? commissionTable()
                      : movementTable()}
                </>
              )}
              {section === "empleados" && (
                <>
                  <div className="employee-toolbar">
                    <Select
                      label="Ver comisiones de"
                      value={employeeId}
                      onChange={setEmployeeId}
                      options={[
                        { value: "", label: "Todos los empleados" },
                        ...employees.map((e) => ({
                          value: e.id,
                          label: e.name,
                        })),
                      ]}
                    />
                    <button
                      className="button primary payout-button"
                      disabled={!data.employees.length}
                      onClick={() =>
                        setDialog({ type: "payout", id: employeeId })
                      }
                    >
                      <Banknote size={22} />
                      Liquidar comisiones
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
                              className="align-right"
                            >
                              Por revisar
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
                                .reduce((sum, c) => sum + c.amount_cents, 0),
                              frozen = rows
                                .filter(
                                  (c) =>
                                    !c.paid_on && c.review_status === "pending",
                                )
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
                                  data-label="Por revisar"
                                  className="number align-right"
                                >
                                  {money(frozen)}
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
                      <h2>{selectedEmployee.name}</h2>
                      {commissionTable(selectedEmployee.id)}
                    </section>
                  )}
                </>
              )}
            </div>
          )
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={22} />
          {toast}
          <button
            className="icon-button"
            aria-label="Cerrar"
            onClick={() => setToast("")}
          >
            <X size={20} />
          </button>
        </div>
      )}
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
              onReview={() => setDialog({ ...dialog, type: "review" })}
            />
          )}
          {dialog.type === "review" && dialog.movement && (
            <SaleReviewForm
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
              onDone={() => {
                saved();
                setToast("Comisiones pagadas");
              }}
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
