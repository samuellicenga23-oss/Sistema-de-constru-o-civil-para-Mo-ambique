import { describe, expect, it } from "vitest";
import {
  MZ_COUNTRY_PROFILE,
  MZ_PROVINCES,
  calendarDaysBetween,
  formatMoneyMz,
  maputoTodayIso,
  normalizeNuit,
  normalizePhoneMz,
  resolveFiscalRateOnDate,
  validateNuitMz,
} from "@sigo/shared";

describe("countryProfile MZ (prompt 01)", () => {
  it("expõe perfil primário Moçambique", () => {
    expect(MZ_COUNTRY_PROFILE.countryCode).toBe("MZ");
    expect(MZ_COUNTRY_PROFILE.locale).toBe("pt-MZ");
    expect(MZ_COUNTRY_PROFILE.timezone).toBe("Africa/Maputo");
    expect(MZ_COUNTRY_PROFILE.currency).toBe("MZN");
    expect(MZ_COUNTRY_PROFILE.currencySymbol).toBe("MT");
    expect(MZ_PROVINCES).toHaveLength(11);
  });

  it("formata dinheiro com 2 casas e símbolo MT", () => {
    const text = formatMoneyMz(1234.5);
    expect(text.endsWith(" MT")).toBe(true);
    expect(text).toMatch(/234/);
    expect(formatMoneyMz(10, { symbol: "code" })).toContain("MZN");
  });

  it("valida NUIT MZ de 9 dígitos e permite estrangeiro sem NUIT", () => {
    expect(normalizeNuit("123 456 789")).toBe("123456789");
    expect(validateNuitMz("123456789").ok).toBe(true);
    expect(validateNuitMz("123").ok).toBe(false);
    expect(validateNuitMz("", { foreign: true }).ok).toBe(true);
    expect(validateNuitMz("", { required: true }).ok).toBe(false);
  });

  it("normaliza telemóvel +258", () => {
    expect(normalizePhoneMz("841234567")).toBe("+258841234567");
    expect(normalizePhoneMz("+258841234567")).toBe("+258841234567");
  });

  it("resolve taxa fiscal effective-dated sem alterar histórico", () => {
    const rows = [
      {
        kind: "iva" as const,
        rate: 0.17,
        effectiveFrom: "2010-01-01",
        effectiveTo: "2022-12-31",
        source: "histórico",
        reference: null,
      },
      {
        kind: "iva" as const,
        rate: 0.16,
        effectiveFrom: "2023-01-01",
        effectiveTo: null,
        source: "referência actual",
        reference: null,
      },
    ];
    expect(resolveFiscalRateOnDate(rows, "iva", "2021-06-01")?.rate).toBe(0.17);
    expect(resolveFiscalRateOnDate(rows, "iva", "2024-06-01")?.rate).toBe(0.16);
  });

  it("calcula dias de calendário e Maputo today sem UTC slice", () => {
    expect(calendarDaysBetween("2026-08-20", "2026-08-21")).toBe(1);
    const today = maputoTodayIso(new Date("2026-08-20T22:30:00.000Z"));
    expect(today).toBe("2026-08-21");
  });
});
