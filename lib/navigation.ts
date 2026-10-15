export const sectionIds = [
  "registro", "ganancia", "pagos", "historial", "empleados",
] as const;

export type Section = (typeof sectionIds)[number];
export type PeriodSection = "ganancia" | "historial" | "empleados";

export function parseSection(value: unknown): Section {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "resumen") return "ganancia";
  if (candidate === "revision") return "historial";
  return sectionIds.includes(candidate as Section) ? candidate as Section : "registro";
}

export function usesPeriod(section: Section): section is PeriodSection {
  return section === "ganancia" || section === "historial" || section === "empleados";
}
