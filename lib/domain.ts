export class ValidationError extends Error {}
export const METHODS = [
  "efectivo",
  "tarjeta",
  "transferencia",
  "otro",
] as const;
export type Method = (typeof METHODS)[number];
export type RecordInput = Record<string, unknown>;
export type PeriodSelection = {
  period: "day" | "week" | "month" | "custom" | "all";
  anchor: string;
  from: string;
  to: string;
};

export function text(
  value: unknown,
  label: string,
  max = 200,
  required = true,
): string {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new ValidationError(`${label}: captura un valor válido.`);
  return value.trim();
}
export function cents(
  value: unknown,
  label = "Importe",
  allowZero = false,
): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new ValidationError(`${label}: importe inválido.`);
  const input = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(input))
    throw new ValidationError(`${label}: usa hasta dos decimales.`);
  const [whole, decimal = ""] = input.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (
    !Number.isSafeInteger(result) ||
    result > 99_999_999_999 ||
    result < (allowZero ? 0 : 1)
  )
    throw new ValidationError(`${label}: importe fuera de rango.`);
  return result;
}
export function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 2000 ||
    Number(value.slice(0, 4)) > 2100 ||
    !Number.isFinite(new Date(value + "T12:00:00Z").getTime()) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new ValidationError("Captura una fecha válida entre 2000 y 2100.");
  return value;
}
export function method(value: unknown): Method {
  if (!METHODS.includes(value as Method))
    throw new ValidationError("Selecciona un método de pago válido.");
  return value as Method;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
  )
    throw new ValidationError("Identificador inválido.");
  return value;
}
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function periodRange(
  period: string,
  anchor: string,
  from?: string,
  to?: string,
) {
  if (period === "all") return { from: "2000-01-01", to: "2100-12-31" };
  if (period === "custom") {
    const start = date(from);
    const end = date(to);
    if (start > end)
      throw new ValidationError(
        "La fecha inicial debe ser anterior o igual a la final.",
      );
    return { from: start, to: end };
  }
  date(anchor);
  const start = new Date(anchor + "T12:00:00Z");
  const end = new Date(start);
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === "month") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else if (period !== "day")
    throw new ValidationError(
      "Selecciona día, semana, mes, rango personalizado o todo.",
    );
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
export function ticketReference(kind: string, id: string) {
  if (
    !["ventas", "ventas_productos"].includes(kind) ||
    !/^[\w-]{1,80}$/.test(id)
  )
    throw new ValidationError("Identidad del ticket inválida.");
  return `LLA1:${kind === "ventas" ? "V" : "P"}:${id}`;
}
export function parseTicketReference(code: string) {
  const match = /^LLA1:(V|P):([\w-]{1,80})$/.exec(code.trim());
  if (!match) return null;
  return {
    kind: match[1] === "V" ? "ventas" : "ventas_productos",
    id: match[2],
  };
}
export type Line = {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
};
export function manualLines(input: unknown): Line[] {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new ValidationError("Agrega entre 1 y 100 conceptos.");
  const lines = input.map((item: RecordInput) => {
    const description = text(item.description, "Concepto", 300);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000)
      throw new ValidationError("La cantidad debe ser un entero positivo.");
    const unitCents = cents(item.unitPrice, "Precio unitario", true);
    return {
      description,
      quantity,
      unitCents,
      totalCents: quantity * unitCents,
    };
  });
  const total = lines.reduce((sum, l) => sum + l.totalCents, 0);
  if (!Number.isSafeInteger(total) || total < 1 || total > 99_999_999_999)
    throw new ValidationError("El total está fuera de rango.");
  return lines;
}
export function commissionAmount(
  total: number,
  mode: unknown,
  value: unknown,
): number {
  if (mode !== "fixed" && mode !== "percent")
    throw new ValidationError("Selecciona el tipo de comisión.");
  const amount = cents(value, mode === "percent" ? "Porcentaje" : "Comisión");
  if (mode === "percent" && amount > 10_000)
    throw new ValidationError("El porcentaje no puede superar 100%.");
  const result =
    mode === "percent" ? Math.round((total * amount) / 10_000) : amount;
  if (result < 1 || result > total)
    throw new ValidationError(
      "La comisión debe ser mayor a cero y no superar la entrada.",
    );
  return result;
}
