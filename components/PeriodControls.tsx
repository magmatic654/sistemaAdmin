"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  businessToday,
  date,
  periodRange,
  type PeriodSelection,
} from "@/lib/domain";
import { DatePicker, Select, shortDate } from "./ui";

export default function PeriodControls({
  value,
  onChange,
  allowAll = false,
  today = businessToday(),
}: {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
  allowAll?: boolean;
  today?: string;
}) {
  const range = periodRange(value.period, value.anchor, value.from, value.to);
  const isCurrent = range.from <= today && range.to >= today;
  const options = [
    {
      value: "day",
      label: value.period === "day" && !isCurrent ? "Día" : "Hoy",
    },
    {
      value: "week",
      label: value.period === "week" && !isCurrent ? "Semana" : "Esta semana",
    },
    {
      value: "month",
      label: value.period === "month" && !isCurrent ? "Mes" : "Este mes",
    },
    { value: "custom", label: "Rango personalizado" },
    ...(allowAll ? [{ value: "all", label: "Todas las pendientes" }] : []),
  ];
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
        : periodRange(period, today);
    onChange({ ...value, period, anchor: today, ...nextRange });
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
      <Select
        label="Período"
        value={value.period}
        options={options}
        onChange={(period) => choose(period as PeriodSelection["period"])}
      />
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
            disabled={range.from <= "2000-01-01"}
            onClick={() => adjacent(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <span aria-live="polite">{interval}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Período siguiente"
            disabled={range.to >= "2100-12-31"}
            onClick={() => adjacent(1)}
          >
            <ChevronRight size={22} />
          </button>
        </div>
      )}
      {(value.period === "custom" || !isCurrent) && value.period !== "all" && (
        <button
          type="button"
          className="button secondary period-return-today"
          onClick={() => choose("day")}
        >
          Volver a hoy
        </button>
      )}
    </div>
  );
}
