export const SIGO_DECIMAL_PLACES = 2;

export function roundToSigoPrecision(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function fixedSigo(value: number): string {
  return roundToSigoPrecision(value).toFixed(SIGO_DECIMAL_PLACES);
}

export function formatSigoNumber(value: number, locale = "pt-MZ"): string {
  return roundToSigoPrecision(value).toLocaleString(locale, {
    minimumFractionDigits: SIGO_DECIMAL_PLACES,
    maximumFractionDigits: SIGO_DECIMAL_PLACES,
  });
}

/**
 * Normaliza apenas números de negócio recebidos em estruturas JSON. Inteiros
 * permanecem inteiros e strings/datas/ficheiros não são alterados.
 */
export function normalizeSigoDecimals<T>(value: T): T {
  if (typeof value === "number") return roundToSigoPrecision(value) as T;
  if (Array.isArray(value)) return value.map((item) => normalizeSigoDecimals(item)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeSigoDecimals(item)]),
    ) as T;
  }
  return value;
}
