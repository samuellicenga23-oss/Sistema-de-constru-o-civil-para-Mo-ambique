import { describe, expect, it } from "vitest";
import { calculateMeasurementPartial, roundMeasurement, sumMeasurementPartials } from "../src/services/measurementFormulaEngine.js";
import { quantityFromMeasurementPartials } from "../src/services/dimensionEngine.js";

describe("precisão e memória de cálculo", () => {
  it("mantém 6 casas internamente", () => {
    expect(roundMeasurement(1.2345674, 6)).toBe(1.234567);
    const partial = calculateMeasurementPartial({ formulaType: "area", count: 1, length: 0.333333, width: 0.333333 }).partial;
    expect(roundMeasurement(partial, 6)).toBe(0.111111);
  });

  it("aplica deduções por localização sem perder casas", () => {
    const wall = calculateMeasurementPartial({ formulaType: "wall_area", count: 1, length: 12.5, height: 2.7 }).partial;
    const door = calculateMeasurementPartial({ formulaType: "wall_area", sign: -1, count: 1, length: 0.9, height: 2.1 }).partial;
    expect(wall).toBeCloseTo(33.75, 6);
    expect(door).toBeCloseTo(-1.89, 6);
    expect(sumMeasurementPartials([wall, door])).toBeCloseTo(31.86, 6);
  });

  it("anula a quantidade quando a última linha desaparece", () => {
    expect(quantityFromMeasurementPartials([12.5, -1.89])).toBeCloseTo(10.61, 6);
    expect(quantityFromMeasurementPartials([])).toBeNull();
  });
});
