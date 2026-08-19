import { describe, expect, it } from "vitest";
import { computeEarnedValueForecast } from "../src/services/projectForecast.js";

describe("EAC / ETC", () => {
  it("EAC = custo actual + ETC sem duplicar compromissos", () => {
    const result = computeEarnedValueForecast({ contractedValue: 1000, actualCost: 400, committedCost: 200 });
    expect(result.available).toBe(true);
    expect(result.etc).toBe(400);
    expect(result.eac).toBe(800);
    expect(result.forecastMargin).toBe(200);
  });

  it("dados incompletos não fabricam margem", () => {
    const result = computeEarnedValueForecast({ contractedValue: 0, actualCost: 10, committedCost: 0 });
    expect(result.available).toBe(false);
    expect(result.forecastMargin).toBeNull();
  });
});
