import { describe, expect, it } from "vitest";
import { calculateBudgetTotals } from "../src/services/budgetTotals.js";

describe("totais do Mapa de Quantidades", () => {
  it("carrega estaleiro, indirectos e margem no preço de venda antes de contingências e IVA", () => {
    const result = calculateBudgetTotals(100_000, {
      siteCostsRate: 0.05,
      indirectCostsRate: 0.08,
      contingenciasRate: 0.1,
      profitMarginRate: 0.15,
      ivaRate: 0.16,
    });

    expect(result.siteCosts).toBe(5_000);
    expect(result.indirectCosts).toBe(8_000);
    expect(result.profitMargin).toBe(16_950);
    expect(result.sellingSubtotal).toBe(129_950);
    expect(result.unitPriceFactor).toBeCloseTo(1.2995);
    expect(result.contingencias).toBeCloseTo(12_995);
    expect(result.subtotal2).toBeCloseTo(142_945);
    expect(result.iva).toBeCloseTo(22_871.2);
    expect(result.total).toBeCloseTo(165_816.2);
  });

  it("não aceita subtotal ou taxas negativas", () => {
    expect(calculateBudgetTotals(-100, {
      siteCostsRate: -1,
      indirectCostsRate: -1,
      contingenciasRate: -1,
      profitMarginRate: -1,
      ivaRate: -1,
    }).total).toBe(0);
  });
});
