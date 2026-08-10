/** Formatação e parsing de valores monetários no estilo pt-MZ (ex.: 6 842 150,46). */

export function formatMoneyAmount(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("pt-MZ", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Aceita entrada do utilizador em pt-MZ (`1 234,56` / `1.234,56`) ou estilo técnico (`1234.56`).
 * Devolve null se o texto estiver vazio ou inválido.
 */
export function parseMoneyAmount(text: string): number | null {
  const raw = text.trim().replace(/\u00a0/g, " ");
  if (!raw) return null;
  let normalized = raw.replace(/\s/g, "");
  if (normalized.includes(",")) {
    // Vírgula = decimal; pontos são milhares.
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function moneyAmountToFormValue(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(fractionDigits);
}
