import { describe, expect, it } from "vitest";
import { fixedSigo, formatSigoNumber, normalizeSigoDecimals, roundToSigoPrecision } from "@sigo/shared";

describe("regra global de precisão do SIGO", () => {
  it("arredonda valores financeiros e medições para duas casas", () => {
    expect(roundToSigoPrecision(123.456)).toBe(123.46);
    expect(roundToSigoPrecision(1.005)).toBe(1.01);
    expect(fixedSigo(8)).toBe("8.00");
    expect(formatSigoNumber(1250.5)).toMatch(/1[ .]?250,50/);
  });

  it("normaliza cargas JSON sem alterar contagens ou texto", () => {
    expect(normalizeSigoDecimals({
      quantity: 12.3456,
      unitPrice: 99.999,
      doors: 3,
      label: "Laje 1",
      dimensions: [2.555, 4],
    })).toEqual({
      quantity: 12.35,
      unitPrice: 100,
      doors: 3,
      label: "Laje 1",
      dimensions: [2.56, 4],
    });
  });
});
