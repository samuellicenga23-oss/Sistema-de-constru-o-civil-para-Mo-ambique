import { describe, expect, it } from "vitest";
import {
  calculateOutstandingBalance,
  calculatePurchaseOrderForecastTotal,
  calculateRemainingCommitment,
} from "../src/services/treasuryForecastMath.js";

describe("matemática do forecast de tesouraria", () => {
  it("calcula a OC completa: linhas + transporte + IVA", () => {
    const total = calculatePurchaseOrderForecastTotal(
      { transportCost: 20, ivaRate: 0.16 },
      [{ quantity: 10, unitCost: 100 }],
    );
    expect(total).toBe(1183.2);
  });

  it("mantém apenas o compromisso da OC que ainda não foi facturado", () => {
    expect(calculateRemainingCommitment(1183.2, 500)).toBe(683.2);
    expect(calculateRemainingCommitment(1183.2, 1400)).toBe(0);
  });

  it("reduz facturas por notas de crédito e pagamentos sem saldo negativo", () => {
    expect(calculateOutstandingBalance(1000, 100, 250)).toBe(650);
    expect(calculateOutstandingBalance(1000, 200, 900)).toBe(0);
  });
});
