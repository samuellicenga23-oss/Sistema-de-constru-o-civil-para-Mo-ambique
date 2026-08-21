import { describe, expect, it } from "vitest";
import {
  fixedSigo,
  formatSigoNumber,
  normalizeSigoDecimals,
  roundToDisplayPrecision,
  roundToSigoPrecision,
} from "@sigo/shared";

describe("precisão técnica vs apresentação do SIGO", () => {
  it("mantém seis casas em cálculos técnicos e duas na apresentação", () => {
    expect(roundToSigoPrecision(123.4567894)).toBe(123.456789);
    expect(roundToDisplayPrecision(123.456)).toBe(123.46);
    expect(roundToDisplayPrecision(1.005)).toBe(1.01);
    expect(fixedSigo(8)).toBe("8.00");
    expect(formatSigoNumber(1250.5)).toMatch(/1[ .]?250,50/);
  });

  it("não destrói a precisão de cargas JSON antes da validação", () => {
    const payload = {
      quantity: 12.3456,
      unitPrice: 99.999,
      doors: 3,
      label: "Laje 1",
      dimensions: [2.555, 4],
      nested: { coefficient: 0.12575 },
    };

    expect(normalizeSigoDecimals(payload)).toEqual(payload);
    expect(normalizeSigoDecimals(payload).quantity).toBe(12.3456);
    expect(normalizeSigoDecimals(payload).dimensions[0]).toBe(2.555);
    expect(normalizeSigoDecimals(payload).nested.coefficient).toBe(0.12575);
  });
});
