import { describe, expect, it } from "vitest";
import { validateNuitMz } from "@sigo/shared";
import {
  validatePaymentMethodCodes,
  validatePracticeClientNuit,
  validateQuoteFxRate,
} from "../src/services/commercialMz.js";

describe("comercial MZ — NUIT, moeda e meios de pagamento", () => {
  it("valida NUIT moçambicano de 9 dígitos", () => {
    expect(validatePracticeClientNuit("123456789", false)).toEqual({ ok: true, nuit: "123456789" });
    expect(validatePracticeClientNuit("12345678", false)).toEqual({
      ok: false,
      error: "NUIT moçambicano deve ter exactamente 9 dígitos.",
    });
  });

  it("permite entidade estrangeira sem NUIT MZ", () => {
    expect(validatePracticeClientNuit(null, true)).toEqual({ ok: true, nuit: null });
    expect(validateNuitMz("ABC123", { foreign: true }).ok).toBe(true);
  });

  it("MZN por omissão sem taxa FX", () => {
    expect(validateQuoteFxRate("MZN", null)).toEqual({ ok: true, fxRate: null });
    expect(validateQuoteFxRate("MZN", 63.5).ok).toBe(false);
  });

  it("USD exige taxa FX explícita", () => {
    expect(validateQuoteFxRate("USD", null).ok).toBe(false);
    expect(validateQuoteFxRate("USD", 63.5)).toEqual({ ok: true, fxRate: "63.500000" });
  });

  it("aceita códigos de meio de pagamento do catálogo MZ", async () => {
    const result = await validatePaymentMethodCodes(["transferencia", "mpesa"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.codes).toEqual(["transferencia", "mpesa"]);
  });

  it("rejeita meios de pagamento desconhecidos", async () => {
    const result = await validatePaymentMethodCodes(["bitcoin"]);
    expect(result.ok).toBe(false);
  });
});
