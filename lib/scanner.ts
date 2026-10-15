import { ValidationError } from "./domain.ts";

/** HID readers type characters; Enter/Tab terminates a scan in the capture field.
 * Strip only transport framing, never repair or guess a sale identity. */
export function scanValue(value: string): string {
  const code = value.trim().replace(/^\]C0/, "");
  if (!code || code.length > 100 || /[\x00-\x1f\x7f]/.test(code))
    throw new ValidationError("Escanea un ticket o escribe su folio.");
  if (code.startsWith("LLA1:") && !/^LLA1:[VP]:[\w-]{1,80}$/.test(code))
    throw new ValidationError("Código incompleto. Revisa el idioma del lector y vuelve a escanear.");
  return code;
}
export function isScanTerminator(key: string): boolean {
  return key === "Enter" || key === "Tab";
}
