export type BudgetRates = {
  siteCostsRate?: number;
  indirectCostsRate?: number;
  contingenciasRate?: number;
  profitMarginRate?: number;
  ivaRate?: number;
};

export type BudgetTotals = {
  subtotal1: number;
  siteCosts: number;
  indirectCosts: number;
  sellingSubtotal: number;
  unitPriceFactor: number;
  contingencias: number;
  profitMargin: number;
  subtotal2: number;
  iva: number;
  total: number;
};

/**
 * Custos globais pertencem ao Mapa de Quantidades, não às composições.
 *
 * Ordem:
 * 1. custo directo dos trabalhos;
 * 2. estaleiro e custos indirectos, calculados sobre o custo directo;
 * 3. margem, calculada sobre custo directo + estaleiro + indirectos;
 * 4. estes custos comerciais são distribuídos pelos preços unitários;
 * 5. contingências e IVA ficam visíveis no resumo do orçamento.
 */
export function calculateBudgetTotals(subtotal1: number, rates: BudgetRates): BudgetTotals {
  const safeSubtotal = Number.isFinite(subtotal1) ? Math.max(0, subtotal1) : 0;
  const siteCostsRate = Math.max(0, rates.siteCostsRate ?? 0);
  const indirectCostsRate = Math.max(0, rates.indirectCostsRate ?? 0);
  const contingenciasRate = Math.max(0, rates.contingenciasRate ?? 0);
  const profitMarginRate = Math.max(0, rates.profitMarginRate ?? 0);
  const ivaRate = Math.max(0, rates.ivaRate ?? 0);

  const siteCosts = safeSubtotal * siteCostsRate;
  const indirectCosts = safeSubtotal * indirectCostsRate;
  const profitBase = safeSubtotal + siteCosts + indirectCosts;
  const profitMargin = profitBase * profitMarginRate;
  const sellingSubtotal = profitBase + profitMargin;
  const unitPriceFactor = safeSubtotal > 0
    ? sellingSubtotal / safeSubtotal
    : (1 + siteCostsRate + indirectCostsRate) * (1 + profitMarginRate);
  const contingencias = sellingSubtotal * contingenciasRate;
  const subtotal2 = sellingSubtotal + contingencias;
  const iva = subtotal2 * ivaRate;

  return {
    subtotal1: safeSubtotal,
    siteCosts,
    indirectCosts,
    sellingSubtotal,
    unitPriceFactor,
    contingencias,
    profitMargin,
    subtotal2,
    iva,
    total: subtotal2 + iva,
  };
}
