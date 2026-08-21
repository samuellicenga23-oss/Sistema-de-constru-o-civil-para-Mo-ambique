export const SIGO_DECIMAL_PLACES = 2;
export const SIGO_TECHNICAL_DECIMAL_PLACES = 6;

function roundToDecimalPlaces(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor;
}

/**
 * Precisão interna usada em cálculos técnicos (quantidades, dimensões, volumes,
 * pesos, coeficientes e produtividade). Não deve ser confundida com a precisão
 * de apresentação monetária/visual.
 */
export function roundToSigoPrecision(value: number): number {
  return roundToDecimalPlaces(value, SIGO_TECHNICAL_DECIMAL_PLACES);
}

/** Arredondamento exclusivo para apresentação/valores que exigem 2 casas. */
export function roundToDisplayPrecision(value: number): number {
  return roundToDecimalPlaces(value, SIGO_DECIMAL_PLACES);
}

export function fixedSigo(value: number): string {
  return roundToDisplayPrecision(value).toFixed(SIGO_DECIMAL_PLACES);
}

export function formatSigoNumber(value: number, locale = "pt-MZ"): string {
  return roundToDisplayPrecision(value).toLocaleString(locale, {
    minimumFractionDigits: SIGO_DECIMAL_PLACES,
    maximumFractionDigits: SIGO_DECIMAL_PLACES,
  });
}

/** Apresentação de quantidades BOQ/medição — 2 casas na UI; valor interno mantém precisão técnica. */
export function formatQuantityDisplay(
  value: number | null | undefined,
  _unit?: string | null,
  locale = "pt-MZ",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // Reservado: precisão configurável por unidade/empresa/documento via _unit.
  return value.toLocaleString(locale, {
    minimumFractionDigits: SIGO_DECIMAL_PLACES,
    maximumFractionDigits: SIGO_DECIMAL_PLACES,
  });
}

/**
 * Compatibilidade com o hook histórico da API. A entrada JSON NÃO é arredondada:
 * a precisão é uma regra do domínio e da persistência, nunca uma transformação
 * global antes da validação. Mantemos a função para não quebrar imports antigos.
 */
export function normalizeSigoDecimals<T>(value: T): T {
  return value;
}
