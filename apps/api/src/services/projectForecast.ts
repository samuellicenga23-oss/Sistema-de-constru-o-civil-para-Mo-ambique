export type EarnedValueInput = {
  contractedValue: number;
  actualCost: number;
  committedCost: number;
  forecastRevenue?: number | null;
  remainingScopeCost?: number | null;
};

export type EarnedValueForecast = {
  available: boolean;
  reason: string | null;
  etc: number | null;
  eac: number | null;
  forecastRevenue: number | null;
  forecastMargin: number | null;
  forecastMarginPct: number | null;
};

export function computeEarnedValueForecast(input: EarnedValueInput): EarnedValueForecast {
  const contracted = Number.isFinite(input.contractedValue) ? input.contractedValue : 0;
  const actual = Math.max(0, input.actualCost);
  const committed = Math.max(0, input.committedCost);
  if (contracted <= 0 && input.remainingScopeCost == null) {
    return { available: false, reason: "Sem orçamento aprovado", etc: null, eac: null, forecastRevenue: null, forecastMargin: null, forecastMarginPct: null };
  }
  const remaining = input.remainingScopeCost != null
    ? Math.max(0, input.remainingScopeCost)
    : Math.max(0, contracted - actual - committed);
  const etc = remaining;
  const eac = actual + etc;
  const revenue = input.forecastRevenue != null && input.forecastRevenue > 0 ? input.forecastRevenue : contracted;
  if (!(revenue > 0)) {
    return { available: false, reason: "Receita prevista indisponível", etc, eac, forecastRevenue: null, forecastMargin: null, forecastMarginPct: null };
  }
  const forecastMargin = revenue - eac;
  return {
    available: true,
    reason: null,
    etc,
    eac,
    forecastRevenue: revenue,
    forecastMargin,
    forecastMarginPct: revenue === 0 ? null : (forecastMargin / revenue) * 100,
  };
}
