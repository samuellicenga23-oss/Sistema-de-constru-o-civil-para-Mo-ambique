import { describe, expect, it } from "vitest";
import { assertVendorNotBlocked, latestStartDate, procurementStartOverdue, supplierScorecard } from "../src/services/vendorGovernance.js";

describe("vendor governance e prazo de compra", () => {
  it("bloqueia fornecedor com motivo", () => {
    expect(() => assertVendorNotBlocked("bloqueado", "NUIT inválido")).toThrow(/NUIT inválido/);
    expect(() => assertVendorNotBlocked("qualificado")).not.toThrow();
  });

  it("score sem amostra suficiente não inventa precisão", () => {
    const card = supplierScorecard({ receiptCount: 1, otifPct: 100, acceptanceRatePct: 100, rfqResponsePct: 100, ncrCount: 0, spend: 10, openAp: 0 });
    expect(card.status).toBe("insufficient");
    expect(card.score).toBeNull();
  });

  it("latest start recua lead + RFQ + aprovação + buffer", () => {
    const start = latestStartDate({ needBy: "2026-08-21", leadTimeDays: 5, rfqDays: 2, approvalDays: 1, bufferDays: 1 });
    expect(start < "2026-08-21").toBe(true);
    expect(procurementStartOverdue("2026-08-10", "2026-08-20", { leadTimeDays: 5 })).toBe(true);
  });
});
