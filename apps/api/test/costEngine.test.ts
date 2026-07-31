import { describe, expect, it } from "vitest";
import { calculateCompositionTotals, computeHourlyRate } from "../src/services/costEngine.js";

describe("motor de custos do catálogo", () => {
  it("carrega o custo horário com horas produtivas e encargos", () => {
    const rate = computeHourlyRate(17_600, 22, 8, 160, 15, 5);
    expect(rate).toBeCloseTo(132, 6);
  });

  it("mantém o cálculo antigo quando não há parâmetros laborais avançados", () => {
    const rate = computeHourlyRate(17_600, 22, 8);
    expect(rate).toBe(100);
  });

  it("mantém a composição no custo técnico directo", () => {
    const result = calculateCompositionTotals({
      labourCost: 100,
      materialCost: 300,
      equipmentCost: 100,
    });

    expect(result.directCost).toBe(500);
    expect(result.auxiliaryCost).toBe(0);
    expect(result.indirectCost).toBe(0);
    expect(result.profit).toBe(0);
    expect(result.unitCost).toBe(500);
  });
});
