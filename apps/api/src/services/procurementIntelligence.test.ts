import { describe, expect, it } from "vitest";
import {
  agingKey,
  allocatePaymentRequestForecast,
  buildAging,
  buildSupplierStatement,
  buildWeeklyCashForecast,
  computeCompetitiveRfqMetric,
  computeMaterialVariance,
  computeSupplierRisk,
} from "./procurementIntelligence.js";

describe("procurement intelligence", () => {
  it("classifica aging sem misturar não vencido e vencido", () => {
    expect(agingKey("2026-08-20", "2026-08-08")).toBe("nao_vencido");
    expect(agingKey("2026-08-01", "2026-08-08")).toBe("1_30");
    expect(agingKey("2026-06-01", "2026-08-08")).toBe("61_90");
    expect(agingKey(null, "2026-08-08")).toBe("sem_vencimento");
  });

  it("soma apenas saldos positivos no aging", () => {
    const aging = buildAging([
      { id: "1", supplierId: "s", supplierName: "A", invoiceNumber: "F1", dueDate: "2026-08-01", issueDate: "2026-07-01", currency: "MZN", outstanding: 100 },
      { id: "2", supplierId: "s", supplierName: "A", invoiceNumber: "F2", dueDate: "2026-09-01", issueDate: "2026-08-01", currency: "MZN", outstanding: 50 },
      { id: "3", supplierId: "s", supplierName: "A", invoiceNumber: "F3", dueDate: "2026-07-01", issueDate: "2026-06-01", currency: "MZN", outstanding: 0 },
    ], "2026-08-08");
    expect(aging.find((x) => x.key === "1_30")?.amount).toBe(100);
    expect(aging.find((x) => x.key === "nao_vencido")?.amount).toBe(50);
  });

  it("limita pedidos concorrentes ao saldo da factura e prioriza aprovados", () => {
    const rows = allocatePaymentRequestForecast(100, [
      { id: "sub", status: "submetido", amount: 100, createdAt: "2026-08-01T00:00:00Z" },
      { id: "ap", status: "aprovado", amount: 70, createdAt: "2026-08-02T00:00:00Z" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("ap");
    expect(rows[0].allocatedAmount).toBe(70);
    expect(rows[1].allocatedAmount).toBe(30);
    expect(rows[1].capped).toBe(true);
  });

  it("não duplica forecast: cada item entra numa única semana", () => {
    const result = buildWeeklyCashForecast([
      { id: "a", source: "pedido_pagamento", confidence: "alta", supplierId: "s", supplierName: "A", reference: "PAY-1", amount: 100, currency: "MZN", forecastDate: "2026-08-10", dateBasis: "requested" },
      { id: "b", source: "ordem_compra", confidence: "media", supplierId: "s", supplierName: "A", reference: "OC-1", amount: 200, currency: "MZN", forecastDate: "2026-08-17", dateBasis: "required" },
    ], "2026-08-08", 4);
    expect(result.totalInHorizon).toBe(300);
    expect(result.weeks.reduce((n, w) => n + w.items.length, 0)).toBe(2);
    expect(result.weeks.reduce((n, w) => n + w.highConfidence, 0)).toBe(100);
  });

  it("coloca itens vencidos na primeira semana, não no passado", () => {
    const result = buildWeeklyCashForecast([
      { id: "a", source: "factura", confidence: "alta", supplierId: "s", supplierName: "A", reference: "F1", amount: 99, currency: "MZN", forecastDate: "2026-07-01", dateBasis: "due" },
    ], "2026-08-08", 2);
    expect(result.weeks[0].amount).toBe(99);
  });

  it("calcula poupança contra mediana e premium contra menor proposta", () => {
    const metric = computeCompetitiveRfqMetric({ rfqId: "r", reference: "RFQ-1", awardedCost: 105, comparableQuoteTotals: [100, 120, 140] });
    expect(metric.medianComparable).toBe(120);
    expect(metric.savingsVsMedian).toBe(15);
    expect(metric.premiumVsLowest).toBe(5);
  });

  it("não inventa poupança quando não há proposta comparável", () => {
    const metric = computeCompetitiveRfqMetric({ rfqId: "r", reference: "RFQ-1", awardedCost: 105, comparableQuoteTotals: [] });
    expect(metric.savingsVsMedian).toBeNull();
    expect(metric.premiumVsLowest).toBeNull();
  });

  it("uma única proposta não é baseline competitivo", () => {
    const metric = computeCompetitiveRfqMetric({ rfqId: "r", reference: "RFQ-1", awardedCost: 105, comparableQuoteTotals: [105] });
    expect(metric.comparableQuoteCount).toBe(1);
    expect(metric.savingsVsMedian).toBeNull();
    expect(metric.premiumVsLowest).toBeNull();
  });

  it("normaliza desvio BOQ pela quantidade efectivamente encomendada", () => {
    const variance = computeMaterialVariance({ materialId: "m", materialName: "Cimento", unit: "saco", requiredQty: 1000, baselineValue: 400000, orderedQty: 250, orderedValue: 112500 });
    expect(variance.baselineUnitCost).toBe(400);
    expect(variance.baselineForOrderedQty).toBe(100000);
    expect(variance.variance).toBe(12500);
    expect(variance.procurementCoveragePct).toBe(25);
  });

  it("sinaliza concentração, atraso e NCR no risco do fornecedor", () => {
    const risk = computeSupplierRisk({ concentrationPct: 55, overdueAmount: 1000, openNcrCount: 2, completedOrders: 4, onTimeRatePct: 50 });
    expect(risk.level).toBe("alto");
    expect(risk.score).toBeGreaterThanOrEqual(80);
    expect(risk.flags.length).toBeGreaterThanOrEqual(3);
  });

  it("statement só altera saldo em movimentos contabilizáveis", () => {
    const rows = buildSupplierStatement([
      { id: "1", date: "2026-08-01", kind: "compromisso", reference: "OC-1", description: "OC", debit: 1000, credit: 0, affectsBalance: false },
      { id: "2", date: "2026-08-02", kind: "factura", reference: "F1", description: "Factura", debit: 600, credit: 0, affectsBalance: true },
      { id: "3", date: "2026-08-03", kind: "pagamento", reference: "P1", description: "Pagamento", debit: 0, credit: 200, affectsBalance: true },
    ]);
    expect(rows[0].balance).toBe(0);
    expect(rows[1].balance).toBe(600);
    expect(rows[2].balance).toBe(400);
  });

  it("ordena factura antes de crédito/pagamento na mesma data", () => {
    const rows = buildSupplierStatement([
      { id: "payment", date: "2026-08-08", kind: "pagamento", reference: "P1", description: "Pagamento", debit: 0, credit: 300, affectsBalance: true },
      { id: "invoice", date: "2026-08-08", kind: "factura", reference: "F1", description: "Factura", debit: 500, credit: 0, affectsBalance: true },
      { id: "credit", date: "2026-08-08", kind: "nota_credito", reference: "NC1", description: "Crédito", debit: 0, credit: 50, affectsBalance: true },
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["factura", "nota_credito", "pagamento"]);
    expect(rows.map((row) => row.balance)).toEqual([500, 450, 150]);
  });
});
