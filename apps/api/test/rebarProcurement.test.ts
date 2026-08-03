import { describe, expect, it } from "vitest";
import { buildRebarPurchasePlan } from "@sigo/shared";

describe("mapa de compra de armaduras", () => {
  it("agrupa por diâmetro e arredonda para varões comerciais inteiros", () => {
    const result = buildRebarPurchasePlan([
      { diameterMm: 10, weightKg: 61.65 },
      { diameterMm: 10, weightKg: 12.33 },
      { diameterMm: 12, weightKg: 106.5 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].diameterMm).toBe(10);
    expect(result[0].scheduledWeightKg).toBeCloseTo(73.98);
    expect(result[0].barsToBuy).toBe(10);
    expect(result[1].diameterMm).toBe(12);
    expect(result[1].barsToBuy).toBe(10);
    expect(result.every((line) => line.purchaseWeightKg >= line.scheduledWeightKg)).toBe(true);
  });
});
