import { describe, expect, it } from "vitest";
import {
  assertRequisitionTransition,
  buildQuoteComparison,
  groupAllocationsBySupplier,
  quoteLineNetUnitCost,
  quoteTotal,
  requiresDecisionReason,
  validateAwardAllocations,
  type RfqLineSnapshot,
  type SupplierQuoteSnapshot,
} from "../src/services/procurementWorkflow.js";

const rfqLines: RfqLineSnapshot[] = [
  { id: "cimento", description: "Cimento 42.5", quantity: 300, unit: "un" },
  { id: "areia", description: "Areia fina", quantity: 20, unit: "m3" },
];

const quotes: SupplierQuoteSnapshot[] = [
  {
    id: "qa",
    supplierId: "a",
    supplierName: "Fornecedor A",
    currency: "MZN",
    transportCost: 5000,
    transportIncluded: false,
    leadTimeDays: 1,
    paymentTerms: "Pronto pagamento",
    validUntil: "2026-08-20",
    status: "submetida",
    version: 1,
    lines: [
      { rfqLineId: "cimento", quantityOffered: 300, unitCost: 450, discountPct: 0 },
      { rfqLineId: "areia", quantityOffered: 20, unitCost: 1600, discountPct: 0 },
    ],
  },
  {
    id: "qb",
    supplierId: "b",
    supplierName: "Fornecedor B",
    currency: "MZN",
    transportCost: 0,
    transportIncluded: true,
    leadTimeDays: 2,
    paymentTerms: "30 dias",
    validUntil: "2026-08-30",
    status: "submetida",
    version: 2,
    lines: [
      { rfqLineId: "cimento", quantityOffered: 300, unitCost: 455, discountPct: 3 },
      { rfqLineId: "areia", quantityOffered: 20, unitCost: 1550, discountPct: 0 },
    ],
  },
  {
    id: "qc",
    supplierId: "c",
    supplierName: "Fornecedor C",
    currency: "MZN",
    transportCost: 0,
    transportIncluded: true,
    leadTimeDays: 4,
    paymentTerms: "50/50",
    validUntil: "2026-08-30",
    status: "submetida",
    version: 1,
    lines: [
      { rfqLineId: "cimento", quantityOffered: 150, unitCost: 430, discountPct: 0 },
      { rfqLineId: "areia", quantityOffered: 20, unitCost: 1500, discountPct: 0 },
    ],
  },
];

describe("procurementWorkflow", () => {
  it("aplica desconto na linha sem alterar a proposta original", () => {
    expect(quoteLineNetUnitCost({ rfqLineId: "x", quantityOffered: 1, unitCost: 100, discountPct: 3 })).toBe(97);
  });

  it("separa custo de transporte do subtotal", () => {
    expect(quoteTotal(quotes[0])).toBe(172000);
    expect(quoteTotal(quotes[1])).toBe(163405);
  });

  it("comparativo usa apenas propostas submetidas e na moeda da RFQ", () => {
    const result = buildQuoteComparison(rfqLines, [
      ...quotes,
      { ...quotes[0], id: "draft", status: "rascunho" },
      { ...quotes[0], id: "usd", currency: "USD" },
    ], "MZN");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.quoteId)).not.toContain("draft");
    expect(result.map((r) => r.quoteId)).not.toContain("usd");
  });

  it("proposta parcial não ganha selo de menor custo contra propostas completas", () => {
    const result = buildQuoteComparison(rfqLines, quotes, "MZN");
    const partial = result.find((r) => r.supplierId === "c")!;
    expect(partial.quantityCoveragePct).toBeLessThan(100);
    expect(partial.isCheapest).toBe(false);
    expect(result.find((r) => r.supplierId === "b")!.isCheapest).toBe(true);
  });

  it("identifica entrega mais rápida independentemente do preço", () => {
    const result = buildQuoteComparison(rfqLines, quotes, "MZN");
    expect(result.find((r) => r.supplierId === "a")!.isFastest).toBe(true);
  });

  it("não permite adjudicar mais do que a quantidade solicitada", () => {
    expect(() => validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qa", supplierId: "a", quantityAwarded: 301, unitCost: 450 },
    ], true)).toThrow(/excede/);
  });

  it("não permite adulterar o preço submetido na adjudicação", () => {
    expect(() => validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qb", supplierId: "b", quantityAwarded: 300, unitCost: 400 },
    ], true)).toThrow(/preço adjudicado/);
  });

  it("permite adjudicação repartida quando a RFQ permite parcial", () => {
    const result = validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qc", supplierId: "c", quantityAwarded: 150, unitCost: 430 },
      { rfqLineId: "cimento", quoteId: "qb", supplierId: "b", quantityAwarded: 150, unitCost: 441.35 },
      { rfqLineId: "areia", quoteId: "qb", supplierId: "b", quantityAwarded: 20, unitCost: 1550 },
    ], true);
    expect(result.complete).toBe(true);
    expect(result.supplierIds.sort()).toEqual(["b", "c"]);
  });

  it("recusa adjudicação final incompleta", () => {
    expect(() => validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qa", supplierId: "a", quantityAwarded: 300, unitCost: 450 },
    ], true)).toThrow(/100%/);
  });

  it("sem adjudicação parcial exige um único fornecedor", () => {
    expect(() => validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qa", supplierId: "a", quantityAwarded: 300, unitCost: 450 },
      { rfqLineId: "areia", quoteId: "qb", supplierId: "b", quantityAwarded: 20, unitCost: 1550 },
    ], false)).toThrow(/repartir/);
  });

  it("agrupa alocações por fornecedor para gerar uma OC por fornecedor", () => {
    const groups = groupAllocationsBySupplier([
      { rfqLineId: "cimento", quoteId: "qa", supplierId: "a", quantityAwarded: 200, unitCost: 450 },
      { rfqLineId: "cimento", quoteId: "qb", supplierId: "b", quantityAwarded: 100, unitCost: 441.35 },
      { rfqLineId: "areia", quoteId: "qb", supplierId: "b", quantityAwarded: 20, unitCost: 1550 },
    ]);
    expect(groups.get("a")).toHaveLength(1);
    expect(groups.get("b")).toHaveLength(2);
  });

  it("exige justificação ao escolher fornecedor que não é o mais barato", () => {
    const comparison = buildQuoteComparison(rfqLines, quotes, "MZN");
    expect(requiresDecisionReason(comparison, ["a"])).toBe(true);
    expect(requiresDecisionReason(comparison, ["b"])).toBe(false);
    expect(requiresDecisionReason(comparison, ["b", "c"])).toBe(true);
  });


  it("não considera proposta expirada como melhor opção e bloqueia a adjudicação", () => {
    const result = buildQuoteComparison(rfqLines, quotes, "MZN", "2026-08-25");
    expect(result.find((r) => r.supplierId === "a")!.isExpired).toBe(true);
    expect(result.find((r) => r.supplierId === "a")!.isCheapest).toBe(false);
    expect(() => validateAwardAllocations(rfqLines, quotes, [
      { rfqLineId: "cimento", quoteId: "qa", supplierId: "a", quantityAwarded: 300, unitCost: 450 },
      { rfqLineId: "areia", quoteId: "qa", supplierId: "a", quantityAwarded: 20, unitCost: 1600 },
    ], false, "2026-08-25")).toThrow(/expirou/);
  });

  it("controla transições da requisição", () => {
    expect(() => assertRequisitionTransition("rascunho", "aprovada")).toThrow();
    expect(() => assertRequisitionTransition("rascunho", "submetida")).not.toThrow();
    expect(() => assertRequisitionTransition("aprovada", "em_cotacao")).not.toThrow();
  });
});
