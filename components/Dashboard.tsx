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
  type Write,
} from "./forms";

type Section = "registro" | "resumen" | "empleados";
type Panel = "ventas" | "salidas" | "cobros" | "proveedores" | "comisiones";
type Dialog = {
  type:
    | "entrada"
    | "salida"
    | "ticket"
    | "employee"
    | "detail"
    | "payment"
    | "payout"
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
  { id: "salidas" as const, label: "Salidas" },
  { id: "cobros" as const, label: "Ventas a crédito" },
  { id: "proveedores" as const, label: "Proveedores" },
  { id: "comisiones" as const, label: "Comisiones" },
];

function Status({ m }: { m: Movement }) {
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
            ? "Cobrado"
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
  const view =
    section === "empleados"
      ? "comisiones"
      : panel === "ventas"
        ? "entradas"
        : panel === "salidas"
          ? "salidas"
          : panel === "comisiones"
            ? "comisiones-pendientes"
            : panel === "proveedores"
              ? "proveedores"
              : "cobros";
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
  function choosePanel(value: Panel) {
    setPanel(value);
    setPage(1);
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
  async function detail(movement: Movement) {
    try {
      const response = await fetch("/api/admin?detail=" + movement.id);
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setDialog({ type: "detail", ...result });
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
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>{panel === "proveedores" ? "Proveedor" : "Concepto"}</th>
                <th>Estado</th>
                <th className="align-right">
                  {panel === "cobros" || panel === "proveedores"
                    ? "Pendiente"
                    : "Importe"}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.movements.map((m) => (
                <tr key={m.id}>
                  <td>
                    {shortDate(m.date)}
                    <small>{m.source_folio || m.reference}</small>
                  </td>
                  <td className="concept-cell">
                    <button className="row-link" onClick={() => void detail(m)}>
                      {panel === "proveedores"
                        ? m.contact || m.concept
                        : m.concept}
                    </button>
                    <small>
                      {panel === "proveedores" ? m.concept : m.contact}
                    </small>
                  </td>
                  <td>
                    <Status m={m} />
                  </td>
                  <td
                    className={
                      "number align-right " + (m.voided_at ? "muted" : "")
                    }
                  >
                    {money(
                      panel === "cobros" || panel === "proveedores"
                        ? m.total_cents - m.paid_cents
                        : m.total_cents,
                    )}
                  </td>
                  <td className="align-right">
                    {panel === "cobros" || panel === "proveedores" ? (
                      <button
                        className="button secondary small"
                        onClick={() =>
                          setDialog({ type: "payment", movement: m })
                        }
                      >
                        {m.kind === "entrada" ? "Cobrar" : "Pagar"}
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        aria-label={
                          "Ver " +
                          (m.source_folio || m.manual_folio || m.concept)
                        }
                        onClick={() => void detail(m)}
                      >
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
        {!!data?.total && (
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
        )}
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
          <table>
            <thead>
              <tr>
                <th>Empleado / fecha</th>
                <th>Venta</th>
                <th className="align-right">Comisión</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.employee_name}</strong>
                    <small>{shortDate(c.date)}</small>
                  </td>
                  <td className="concept-cell">
                    {c.source_folio || c.concept}
                  </td>
                  <td className="number align-right">
                    {money(c.amount_cents)}
                  </td>
                  <td>
                    <span
                      className={"pill " + (c.paid_on ? "success" : "pending")}
                    >
                      {c.paid_on ? "Pagada" : "Pendiente"}
                    </span>
                  </td>
                  <td>
                    {!c.paid_on && (
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
                  <div className="summary-grid">
                    <div className="summary-card gain">
                      <span>Ganancia</span>
                      <strong
                        className={
                          "number " + (summary!.profit < 0 ? "danger" : "")
                        }
                      >
                        {money(summary!.profit)}
                      </strong>
                    </div>
                    <div className="summary-card collected">
                      <span>Cobrado</span>
                      <strong className="number">
                        {money(summary!.collected)}
                      </strong>
                    </div>
                    <button
                      className="summary-card supplier-due"
                      onClick={() => choosePanel("proveedores")}
                    >
                      <span>Por pagar a proveedores</span>
                      <strong className="number">
                        {money(summary!.payable)}
                      </strong>
                    </button>
                    <button
                      className="summary-card employee-due"
                      onClick={() => choosePanel("comisiones")}
                    >
                      <span>Comisiones por pagar</span>
                      <strong className="number">
                        {money(summary!.employeePayable)}
                      </strong>
                    </button>
                  </div>
                  <div className="history-header">
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
                    {panel === "cobros" && (
                      <strong className="number">
                        {money(summary!.receivable)}
                      </strong>
                    )}
                  </div>
                  {panel === "cobros" && (
                    <p className="credit-panel-note">
                      Saldo pendiente de las ventas registradas con pago parcial
                      o a crédito.
                    </p>
                  )}
                  {panel === "comisiones" ? commissionTable() : movementTable()}
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
                      <table>
                        <thead>
                          <tr>
                            <th>Empleado</th>
                            <th className="align-right">Comisiones</th>
                            <th className="align-right">Pagado</th>
                            <th className="align-right">Pendiente</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map((employee) => {
                            const rows = commissions.filter(
                                (c) => c.employee_id === employee.id,
                              ),
                              total = rows.reduce(
                                (sum, c) => sum + c.amount_cents,
                                0,
                              ),
                              paid = rows
                                .filter((c) => c.paid_on)
                                .reduce((sum, c) => sum + c.amount_cents, 0);
                            return (
                              <tr
                                key={employee.id}
                                className={
                                  employeeId === employee.id
                                    ? "selected-row"
                                    : ""
                                }
                              >
                                <td>
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
                                <td className="number align-right">
                                  {money(total)}
                                </td>
                                <td className="number align-right">
                                  {money(paid)}
                                </td>
                                <td className="number align-right">
                                  {money(total - paid)}
                                </td>
                                <td>
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
