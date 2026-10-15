"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

export const money = (value: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    value / 100,
  );
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value.slice(0, 10) + "T12:00:00Z"));

export function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="choice" ref={ref}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <button
        type="button"
        className="choice-trigger"
        aria-labelledby={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              ref.current
                ?.querySelector<HTMLButtonElement>('[role="option"]')
                ?.focus(),
            );
          }
        }}
      >
        <span>
          {options.find((option) => option.value === value)?.label ||
            "Seleccionar"}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          className="choice-menu"
          role="listbox"
          aria-labelledby={id}
          onKeyDown={(event) => {
            const buttons = [
              ...ref.current!.querySelectorAll<HTMLButtonElement>(
                '[role="option"]',
              ),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus();
            }
            if (event.key === "Escape") {
              setOpen(false);
              ref.current?.querySelector("button")?.focus();
            }
          }}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option.value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                ref.current?.querySelector("button")?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DatePicker({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [month, setMonth] = useState(value.slice(0, 7) + "-01");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const first = new Date(month + "T12:00:00Z"),
    offset = (first.getUTCDay() + 6) % 7,
    days = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
  function move(by: number) {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + by);
    setMonth(next.toISOString().slice(0, 10));
  }
  return (
    <div className="calendar-field" ref={ref}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <button
        className="choice-trigger"
        type="button"
        aria-labelledby={id}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setMonth(value.slice(0, 7) + "-01");
          setOpen(!open);
        }}
      >
        <span>{shortDate(value)}</span>
        <CalendarDays size={16} />
      </button>
      {open && (
        <div
          className="calendar-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="calendar-heading">
            <button
              type="button"
              className="icon-button"
              aria-label="Mes anterior"
              onClick={() => move(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {new Intl.DateTimeFormat("es-MX", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(first)}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Mes siguiente"
              onClick={() => move(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="calendar-grid">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"s" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = month.slice(0, 8) + String(i + 1).padStart(2, "0");
              return (
                <button
                  className={value === day ? "selected" : ""}
                  type="button"
                  key={day}
                  aria-label={shortDate(day)}
                  onClick={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <label className="calendar-direct">
            Fecha (AAAA-MM-DD)
            <input
              defaultValue={value}
              pattern="\d{4}-\d{2}-\d{2}"
              onBlur={(event) => {
                const input = event.target.value;
                if (
                  /^\d{4}-\d{2}-\d{2}$/.test(input) &&
                  Number.isFinite(new Date(input).getTime())
                )
                  onChange(input);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  busy = false,
  compactSale = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  compactSale?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ||
      ref.current?.querySelector<HTMLElement>(
        ".modal-body input:not([disabled]),.modal-body button:not([disabled]),.modal-body textarea:not([disabled])",
      ) ||
      ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={
        "modal-backdrop" + (compactSale ? " manual-sale-backdrop" : "")
      }
    >
      <div
        className={"modal" + (compactSale ? " manual-sale-modal" : "")}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key === "Tab") {
            const focusable = [
              ...ref.current!.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
              ),
            ];
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="modal-header">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar formulario"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
