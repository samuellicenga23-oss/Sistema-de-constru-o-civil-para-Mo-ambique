import { describe, expect, it } from "vitest";
import { resolveLeadTimeDays, resolvePaymentTermsCode } from "../src/services/procurementMz.js";

describe("procurement MZ", () => {
  it("mapeia termos de pagamento para catálogo 30/60 dias", () => {
    expect(resolvePaymentTermsCode("30 dias")).toBe("30_dias");
    expect(resolvePaymentTermsCode("Crédito 60 dias")).toBe("60_dias");
    expect(resolvePaymentTermsCode(null)).toBe("30_dias");
  });

  it("resolve lead time por zona quando configurado", () => {
    const zoneId = "zone-a";
    expect(resolveLeadTimeDays({ defaultLeadTimeDays: 10, leadTimeByZone: { [zoneId]: 4 }, zoneId: null }, zoneId)).toBe(4);
    expect(resolveLeadTimeDays({ defaultLeadTimeDays: 10, leadTimeByZone: null, zoneId: null })).toBe(10);
  });
});
