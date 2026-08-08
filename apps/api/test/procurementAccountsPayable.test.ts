import { describe, expect, it } from "vitest";
import { computePayableBalance, computeThreeWayMatch, validateNonconformityResolution } from "../src/services/procurementAccountsPayable.js";

const po = [{ id: "l1", materialId: "m1", orderedQty: 100, unitCost: 445, currency: "MZN" }];

describe("three-way match", () => {
  it("aprova factura exacta até quantidade aceite", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 80 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 80, unitCost: 445 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.exactMatch).toBe(true);
    expect(result.canApprove).toBe(true);
    expect(result.total).toBe(41296);
  });

  it("bloqueia factura acima do aceite", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 80 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 81, unitCost: 445 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.canApproveWithVariance).toBe(false);
    expect(result.hardBlocks.length).toBe(1);
  });

  it("considera facturação parcial anterior", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 100 }, previouslyInvoicedQtyByLine: { l1: 60 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 40, unitCost: 445 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.exactMatch).toBe(true);
  });

  it("bloqueia dupla facturação da quantidade já reservada", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 100 }, previouslyInvoicedQtyByLine: { l1: 70 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 40, unitCost: 445 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.hardBlocks.length).toBe(1);
  });

  it("preço diferente é variância autorizável, não hard block", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 100 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 100, unitCost: 450 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.canApprove).toBe(false);
    expect(result.canApproveWithVariance).toBe(true);
    expect(result.softVariances.length).toBe(1);
  });

  it("transporte acima da OC é variância", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 100 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 100, unitCost: 445 }], poTransportCost: 5000, previouslyInvoicedTransport: 3000, invoiceTransportCost: 2500, poIvaRate: 0.16, invoiceIvaRate: 0.16 });
    expect(result.canApproveWithVariance).toBe(true);
    expect(result.softVariances.some((x) => x.includes("Transporte"))).toBe(true);
  });

  it("IVA diferente é variância", () => {
    const result = computeThreeWayMatch({ poLines: po, acceptedQtyByLine: { l1: 100 }, invoiceLines: [{ purchaseOrderLineId: "l1", quantity: 100, unitCost: 445 }], poTransportCost: 0, invoiceTransportCost: 0, poIvaRate: 0.16, invoiceIvaRate: 0.17 });
    expect(result.softVariances.some((x) => x.includes("IVA"))).toBe(true);
  });
});

describe("contas a pagar", () => {
  it("calcula pagamentos parciais e notas de crédito", () => {
    const balance = computePayableBalance({ grossAmount: 116000, payments: [40000, 20000], acceptedCreditNotes: [6000] });
    expect(balance.netPayable).toBe(110000);
    expect(balance.paid).toBe(60000);
    expect(balance.outstanding).toBe(50000);
    expect(balance.status).toBe("parcialmente_paga");
  });

  it("detecta pagamento acima do líquido", () => {
    const balance = computePayableBalance({ grossAmount: 100, payments: [95], acceptedCreditNotes: [10] });
    expect(balance.outstanding).toBe(0);
    expect(balance.overpaid).toBe(5);
  });
});

describe("não-conformidade", () => {
  it("valida substituição dentro da quantidade rejeitada", () => {
    expect(validateNonconformityResolution({ rejectedQty: 20, resolution: "substituicao", replacementQty: 20 }).ok).toBe(true);
    expect(validateNonconformityResolution({ rejectedQty: 20, resolution: "substituicao", replacementQty: 21 }).ok).toBe(false);
  });

  it("nota de crédito exige valor", () => {
    expect(validateNonconformityResolution({ rejectedQty: 5, resolution: "nota_credito", creditAmount: 0 }).ok).toBe(false);
  });
});

describe("reservas temporais de factura", () => {
  it("factura posterior em revisão não bloqueia retroactivamente a anterior", async () => {
    const { shouldReserveInvoice } = await import("../src/services/procurementAccountsPayable.js");
    expect(shouldReserveInvoice({ candidateId: "later", candidateStatus: "submetida", candidateCreatedAt: "2026-08-10T10:00:00Z", currentCreatedAt: "2026-08-10T09:00:00Z" })).toBe(false);
    expect(shouldReserveInvoice({ candidateId: "earlier", candidateStatus: "submetida", candidateCreatedAt: "2026-08-10T08:00:00Z", currentCreatedAt: "2026-08-10T09:00:00Z" })).toBe(true);
  });

  it("factura aprovada reserva sempre a quantidade", async () => {
    const { shouldReserveInvoice } = await import("../src/services/procurementAccountsPayable.js");
    expect(shouldReserveInvoice({ candidateId: "approved", candidateStatus: "aprovada", candidateCreatedAt: "2026-08-11T10:00:00Z", currentCreatedAt: "2026-08-10T09:00:00Z" })).toBe(true);
  });
});

describe("devoluções", () => {
  it("permite parcelas sem ultrapassar o rejeitado", async () => {
    const { validateGoodsReturn } = await import("../src/services/procurementAccountsPayable.js");
    expect(validateGoodsReturn({ rejectedQty: 20, alreadyReturnedQty: 5, quantity: 15 }).ok).toBe(true);
    expect(validateGoodsReturn({ rejectedQty: 20, alreadyReturnedQty: 5, quantity: 16 }).ok).toBe(false);
  });
});
