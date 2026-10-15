"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { date, periodRange, type PeriodSelection } from "@/lib/domain";
import { DatePicker, shortDate } from "./ui";

const options = [
  { id: "day", label: "Día" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "custom", label: "Rango personalizado" },
] as const;

export default function PeriodControls({
  value,
  onChange,
  allowAll = false,
}: {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
  allowAll?: boolean;
}) {
  const range = periodRange(value.period, value.anchor, value.from, value.to);
  const interval =
    value.period === "month"
      ? new Intl.DateTimeFormat("es-MX", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(range.from + "T12:00:00Z"))
      : range.from === range.to
        ? shortDate(range.from)
        : `${shortDate(range.from)} – ${shortDate(range.to)}`;

  function choose(period: PeriodSelection["period"]) {
    const nextRange =
      period === "custom"
        ? value.period === "all"
          ? periodRange("month", value.anchor)
          : range
        : periodRange(period, value.anchor);
    onChange({ ...value, period, ...nextRange });
  }
  function adjacent(direction: number) {
    const next = new Date(value.anchor + "T12:00:00Z");
    if (value.period === "month")
      next.setUTCMonth(next.getUTCMonth() + direction, 1);
    else
      next.setUTCDate(
        next.getUTCDate() + direction * (value.period === "week" ? 7 : 1),
      );
    const anchor = next.toISOString().slice(0, 10);
    if (anchor < "2000-01-01" || anchor > "2100-12-31") return;
    onChange({
      ...value,
      anchor,
      ...periodRange(value.period, anchor),
    });
  }
  function endpoint(field: "from" | "to", input: string) {
    try {
      date(input);
      onChange({
        ...value,
        [field]: input,
        ...(field === "from" && input > value.to ? { to: input } : {}),
        ...(field === "to" && input < value.from ? { from: input } : {}),
      });
    } catch {
      // The calendar keeps the previous valid endpoint for an invalid typed date.
    }
  }

  return (
    <div className="period-selector">
      <div className="period-options" role="group" aria-label="Período">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value.period === option.id}
            className={value.period === option.id ? "selected" : ""}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
        {allowAll && (
          <button
            type="button"
            className={
              value.period === "all" ? "selected all-pending" : "all-pending"
            }
            aria-pressed={value.period === "all"}
            onClick={() => choose("all")}
          >
            Todas las pendientes
          </button>
        )}
      </div>
      {value.period === "custom" ? (
        <div className="period-custom">
          <DatePicker
            label="Desde"
            value={value.from}
            onChange={(from) => endpoint("from", from)}
          />
          <DatePicker
            label="Hasta"
            value={value.to}
            onChange={(to) => endpoint("to", to)}
          />
        </div>
      ) : value.period === "all" ? (
        <p className="period-all-label">Sin límite de fecha</p>
      ) : (
        <div className="period-interval">
          <button
            type="button"
            className="icon-button"
            aria-label="Período anterior"
            disabled={range.from === "2000-01-01"}
            onClick={() => adjacent(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <span aria-live="polite">{interval}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Período siguiente"
            disabled={range.to === "2100-12-31"}
            onClick={() => adjacent(1)}
          >
            <ChevronRight size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
