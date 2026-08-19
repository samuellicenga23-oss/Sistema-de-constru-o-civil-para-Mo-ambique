import { describe, expect, it } from "vitest";
import {
  calendarDelayDays,
  computeSupplierPerformance,
  summarizeFulfillment,
  validateReceipt,
  validateShipment,
} from "../src/services/procurementFulfillment.js";

const orderLines = [
  { id: "l1", materialId: "m1", quantity: 100, unitCost: 10 },
  { id: "l2", materialId: "m2", quantity: 50, unitCost: 20 },
];

describe("procurement fulfillment", () => {
  it("aceita recepção parcial e não infla stock com rejeitados", () => {
    const result = validateReceipt(orderLines, [], [{ purchaseOrderLineId: "l1", deliveredQty: 60, acceptedQty: 55, rejectedQty: 5 }]);
    expect(result.ok).toBe(true);
    const summary = summarizeFulfillment(orderLines, [], [{ purchaseOrderLineId: "l1", acceptedQty: 55, rejectedQty: 5, receiptDate: "2026-08-20", confirmed: true }], "em_transito");
    expect(summary.status).toBe("parcialmente_recebido");
    expect(summary.lines[0].acceptedQty).toBe(55);
    expect(summary.lines[0].rejectedQty).toBe(5);
    expect(summary.acceptedValue).toBe(550);
    expect(summary.rejectedValue).toBe(50);
  });

  it("bloqueia aceite acumulado acima da OC", () => {
    const result = validateReceipt(orderLines, [{ purchaseOrderLineId: "l1", acceptedQty: 90, rejectedQty: 0, receiptDate: "2026-08-20", confirmed: true }], [{ purchaseOrderLineId: "l1", deliveredQty: 20, acceptedQty: 20, rejectedQty: 0 }]);
    expect(result.ok).toBe(false);
  });

  it("exige entregue = aceite + rejeitado", () => {
    const result = validateReceipt(orderLines, [], [{ purchaseOrderLineId: "l1", deliveredQty: 20, acceptedQty: 15, rejectedQty: 2 }]);
    expect(result.ok).toBe(false);
  });

  it("permite substituição depois de material rejeitado porque limita pelo aceite", () => {
    const result = validateReceipt(orderLines, [{ purchaseOrderLineId: "l1", acceptedQty: 80, rejectedQty: 20, receiptDate: "2026-08-20", confirmed: true }], [{ purchaseOrderLineId: "l1", deliveredQty: 20, acceptedQty: 20, rejectedQty: 0 }]);
    expect(result.ok).toBe(true);
  });

  it("bloqueia expedição acumulada superior à OC", () => {
    const result = validateShipment(orderLines, [{ purchaseOrderLineId: "l1", quantity: 70, shipmentStatus: "expedido" }], [{ purchaseOrderLineId: "l1", quantity: 40 }], []);
    expect(result.ok).toBe(false);
  });

  it("ignora expedição cancelada na capacidade restante", () => {
    const result = validateShipment(orderLines, [{ purchaseOrderLineId: "l1", quantity: 70, shipmentStatus: "cancelado" }], [{ purchaseOrderLineId: "l1", quantity: 100 }], []);
    expect(result.ok).toBe(true);
  });


  it("permite nova expedição para substituir rejeitados de carga já entregue", () => {
    const result = validateShipment(
      orderLines,
      [{ purchaseOrderLineId: "l1", quantity: 100, shipmentStatus: "entregue" }],
      [{ purchaseOrderLineId: "l1", quantity: 20 }],
      [{ purchaseOrderLineId: "l1", acceptedQty: 80, rejectedQty: 20, receiptDate: "2026-08-20", confirmed: true }],
    );
    expect(result.ok).toBe(true);
  });

  it("marca recebido apenas quando todas as linhas estão aceites", () => {
    const receipts = [
      { purchaseOrderLineId: "l1", acceptedQty: 100, rejectedQty: 0, receiptDate: "2026-08-20", confirmed: true },
      { purchaseOrderLineId: "l2", acceptedQty: 50, rejectedQty: 0, receiptDate: "2026-08-20", confirmed: true },
    ];
    const summary = summarizeFulfillment(orderLines, [], receipts, "parcialmente_recebido");
    expect(summary.status).toBe("recebido");
    expect(summary.fullyAccepted).toBe(true);
    expect(summary.fillRatePct).toBe(100);
  });

  it("calcula atraso em dias de calendário sem valores negativos", () => {
    expect(calendarDelayDays("2026-08-20", "2026-08-23")).toBe(3);
    expect(calendarDelayDays("2026-08-20", "2026-08-19")).toBe(0);
  });

  it("não fabrica score sem histórico observável", () => {
    const result = computeSupplierPerformance([]);
    expect(result.score).toBeNull();
    expect(result.otifPct).toBeNull();
    expect(result.acceptanceRatePct).toBeNull();
  });

  it("calcula OTIF, qualidade e confirmação sobre denominadores honestos", () => {
    const result = computeSupplierPerformance([
      { orderId: "1", requiredByDate: "2026-08-20", promisedDeliveryDate: "2026-08-20", approvedAt: "2026-08-10T08:00:00Z", supplierConfirmedAt: "2026-08-10T12:00:00Z", finalReceiptDate: "2026-08-20", fullyAccepted: true, orderedValue: 1000, acceptedValue: 1000, rejectedValue: 0, completed: true },
      { orderId: "2", requiredByDate: "2026-08-20", promisedDeliveryDate: "2026-08-21", approvedAt: "2026-08-10T08:00:00Z", supplierConfirmedAt: "2026-08-11T08:00:00Z", finalReceiptDate: "2026-08-22", fullyAccepted: true, orderedValue: 1000, acceptedValue: 950, rejectedValue: 50, completed: true },
      { orderId: "3", requiredByDate: null, promisedDeliveryDate: null, approvedAt: null, supplierConfirmedAt: null, finalReceiptDate: null, fullyAccepted: false, orderedValue: 500, acceptedValue: 0, rejectedValue: 0, completed: false },
    ]);
    expect(result.onTimeRatePct).toBe(50);
    expect(result.inFullRatePct).toBe(100);
    expect(result.otifPct).toBe(50);
    expect(result.averageDelayDays).toBe(0.5);
    expect(result.needByHitRatePct).toBe(50);
    expect(result.averageNeedByDelayDays).toBe(1);
    expect(result.rejectionRatePct).toBeCloseTo(2.5);
    expect(result.averageConfirmationHours).toBe(14);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeCloseTo(68.25);
    expect(result.scorecard?.status).toBe("insufficient");
  });
});
