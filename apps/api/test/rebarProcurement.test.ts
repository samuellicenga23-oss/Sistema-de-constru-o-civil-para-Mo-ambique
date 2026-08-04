import { describe, expect, it } from "vitest";
import {
  buildRebarPurchasePlan,
  computeSlabRebarWeightLines,
  DEFAULT_REBAR_LENGTH_M,
  DEFAULT_SLAB_LAP_FACTOR,
  meshWeightKgPerM2,
} from "@sigo/shared";

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
    expect(result[0].commercialBarLengthM).toBe(DEFAULT_REBAR_LENGTH_M);
    expect(result[0].barsToBuy).toBe(Math.ceil(result[0].requiredLengthM / DEFAULT_REBAR_LENGTH_M));
    expect(result[1].diameterMm).toBe(12);
    expect(result[1].barsToBuy).toBe(Math.ceil(result[1].requiredLengthM / DEFAULT_REBAR_LENGTH_M));
    expect(result.every((line) => line.purchaseWeightKg >= line.scheduledWeightKg)).toBe(true);
  });

  it("malha dual ≈ 2× malha única e emendas aumentam o aço", () => {
    const directions = [
      { diameterMm: 8, spacingCm: 15, role: "longitudinal" },
      { diameterMm: 6, spacingCm: 15, role: "transversal" },
    ];
    const areaM2 = 284;
    const single = computeSlabRebarWeightLines({ areaM2, layers: [{ label: "única", directions }] });
    const dual = computeSlabRebarWeightLines({
      areaM2,
      layers: [
        { label: "inferior", directions },
        { label: "superior", directions },
      ],
    });
    const withLap = computeSlabRebarWeightLines({
      areaM2,
      layers: [{ label: "única", directions }],
      lapFactor: DEFAULT_SLAB_LAP_FACTOR,
    });
    const singleKg = single.reduce((s, l) => s + l.weightKg, 0);
    const dualKg = dual.reduce((s, l) => s + l.weightKg, 0);
    const lapKg = withLap.reduce((s, l) => s + l.weightKg, 0);
    expect(dualKg).toBeCloseTo(singleKg * 2, 5);
    expect(lapKg).toBeCloseTo(singleKg * DEFAULT_SLAB_LAP_FACTOR, 5);
    expect(meshWeightKgPerM2(8, 15)).toBeGreaterThan(0);
  });
});
