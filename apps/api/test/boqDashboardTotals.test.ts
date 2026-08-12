import { describe, expect, it } from "vitest";
import { calculateBudgetDocumentTotals } from "../src/services/boqEngine.js";
import { calculateBudgetTotals } from "../src/services/budgetTotals.js";
import type { budgetDocuments } from "../src/db/schema.js";

function document(id: string, rates: Partial<Record<"siteCostsRate" | "indirectCostsRate" | "contingenciasRate" | "profitMarginRate" | "ivaRate", string>> = {}) {
  return {
    id,
    projectId: "00000000-0000-0000-0000-000000000001",
    title: "Teste",
    documentType: "orcamento",
    sourceMeasurementDocumentId: null,
    sourceMeasurementFingerprint: null,
    revision: null,
    fileNumber: null,
    currency: "MZN",
    documentDate: null,
    status: "rascunho",
    submittedByUserId: null,
    approvedByUserId: null,
    approvalNote: null,
    createdAt: new Date(),
    lastEstimateReport: null,
    siteCostsRate: "0.05",
    indirectCostsRate: "0.03",
    contingenciasRate: "0.10",
    profitMarginRate: "0.12",
    ivaRate: "0.16",
    ...rates,
  } as typeof budgetDocuments.$inferSelect;
}

describe("dashboard budget totals", () => {
  it("uses the same commercial formula as the full BOQ summary", () => {
    const doc = document("00000000-0000-0000-0000-000000000010");
    const totals = calculateBudgetDocumentTotals([doc], [
      { documentId: doc.id, quantity: "10", unitPrice: "150.25" },
      { documentId: doc.id, quantity: "2.5", unitPrice: "800" },
      { documentId: doc.id, quantity: null, unitPrice: "99" },
    ]);
    const expected = calculateBudgetTotals(3_502.5, {
      siteCostsRate: 0.05,
      indirectCostsRate: 0.03,
      contingenciasRate: 0.10,
      profitMarginRate: 0.12,
      ivaRate: 0.16,
    });

    expect(totals.get(doc.id)).toBeCloseTo(expected.total, 8);
  });

  it("keeps documents without priced items at zero", () => {
    const empty = document("00000000-0000-0000-0000-000000000011");
    expect(calculateBudgetDocumentTotals([empty], []).get(empty.id)).toBe(0);
  });
});
