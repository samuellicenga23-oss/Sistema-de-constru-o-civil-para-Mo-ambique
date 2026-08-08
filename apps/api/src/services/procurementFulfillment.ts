export type FulfillmentStatus =
  | "aguarda_confirmacao"
  | "confirmado"
  | "em_preparacao"
  | "pronto_expedir"
  | "em_transito"
  | "parcialmente_recebido"
  | "recebido"
  | "fechado";

export type SupplierConfirmationStatus = "pendente" | "confirmado" | "alteracao_solicitada" | "recusado";

export type OrderLineSnapshot = {
  id: string;
  materialId: string;
  quantity: number;
  unitCost: number;
};

export type ReceiptLineSnapshot = {
  purchaseOrderLineId: string;
  acceptedQty: number;
  rejectedQty: number;
  receiptDate: string;
  confirmed: boolean;
};

export type ShipmentLineSnapshot = {
  purchaseOrderLineId: string;
  quantity: number;
  shipmentStatus: "rascunho" | "pronto" | "expedido" | "entregue" | "cancelado";
};

export type FulfillmentLineSummary = {
  purchaseOrderLineId: string;
  orderedQty: number;
  dispatchedQty: number;
  inTransitQty: number;
  acceptedQty: number;
  rejectedQty: number;
  remainingToDispatchQty: number;
  remainingToReceiveQty: number;
  acceptedValue: number;
  rejectedValue: number;
};

export type FulfillmentSummary = {
  status: FulfillmentStatus;
  lines: FulfillmentLineSummary[];
  orderedValue: number;
  acceptedValue: number;
  rejectedValue: number;
  rejectionRatePct: number;
  fillRatePct: number;
  fullyAccepted: boolean;
};

const EPS = 0.0001;

export function summarizeFulfillment(
  orderLines: OrderLineSnapshot[],
  shipments: ShipmentLineSnapshot[],
  receipts: ReceiptLineSnapshot[],
  currentStatus: FulfillmentStatus,
): FulfillmentSummary {
  const confirmedReceipts = receipts.filter((row) => row.confirmed);
  const activeShipments = shipments.filter((row) => row.shipmentStatus !== "cancelado");
  const lines = orderLines.map((line) => {
    const dispatchedQty = activeShipments
      .filter((row) => row.purchaseOrderLineId === line.id && ["expedido", "entregue"].includes(row.shipmentStatus))
      .reduce((sum, row) => sum + row.quantity, 0);
    const inTransitQty = activeShipments
      .filter((row) => row.purchaseOrderLineId === line.id && ["rascunho", "pronto", "expedido"].includes(row.shipmentStatus))
      .reduce((sum, row) => sum + row.quantity, 0);
    const acceptedQty = confirmedReceipts
      .filter((row) => row.purchaseOrderLineId === line.id)
      .reduce((sum, row) => sum + row.acceptedQty, 0);
    const rejectedQty = confirmedReceipts
      .filter((row) => row.purchaseOrderLineId === line.id)
      .reduce((sum, row) => sum + row.rejectedQty, 0);
    return {
      purchaseOrderLineId: line.id,
      orderedQty: line.quantity,
      dispatchedQty,
      inTransitQty,
      acceptedQty,
      rejectedQty,
      remainingToDispatchQty: Math.max(0, line.quantity - acceptedQty - inTransitQty),
      remainingToReceiveQty: Math.max(0, line.quantity - acceptedQty),
      acceptedValue: acceptedQty * line.unitCost,
      rejectedValue: rejectedQty * line.unitCost,
    };
  });

  const orderedValue = orderLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const acceptedValue = lines.reduce((sum, line) => sum + line.acceptedValue, 0);
  const rejectedValue = lines.reduce((sum, line) => sum + line.rejectedValue, 0);
  const fullyAccepted = lines.length > 0 && lines.every((line) => line.acceptedQty + EPS >= line.orderedQty);
  const anyAccepted = lines.some((line) => line.acceptedQty > EPS);

  let status = currentStatus;
  if (fullyAccepted) status = "recebido";
  else if (anyAccepted) status = "parcialmente_recebido";

  const deliveredValue = acceptedValue + rejectedValue;
  return {
    status,
    lines,
    orderedValue,
    acceptedValue,
    rejectedValue,
    rejectionRatePct: deliveredValue > EPS ? (rejectedValue / deliveredValue) * 100 : 0,
    fillRatePct: orderedValue > EPS ? Math.min(100, (acceptedValue / orderedValue) * 100) : 0,
    fullyAccepted,
  };
}

export type ReceiptInputLine = {
  purchaseOrderLineId: string;
  deliveredQty: number;
  acceptedQty: number;
  rejectedQty: number;
};

export function validateReceipt(
  orderLines: OrderLineSnapshot[],
  previousReceipts: ReceiptLineSnapshot[],
  inputLines: ReceiptInputLine[],
): { ok: true } | { ok: false; error: string } {
  const orderById = new Map(orderLines.map((line) => [line.id, line]));
  if (!inputLines.length) return { ok: false, error: "A recepção deve ter pelo menos uma linha" };
  if (new Set(inputLines.map((line) => line.purchaseOrderLineId)).size !== inputLines.length) {
    return { ok: false, error: "A mesma linha da OC não pode aparecer duas vezes na recepção" };
  }

  for (const input of inputLines) {
    const orderLine = orderById.get(input.purchaseOrderLineId);
    if (!orderLine) return { ok: false, error: "Linha de OC inválida" };
    if (!(input.deliveredQty > 0)) return { ok: false, error: "Quantidade entregue deve ser positiva" };
    if (input.acceptedQty < 0 || input.rejectedQty < 0) return { ok: false, error: "Quantidades aceites/rejeitadas não podem ser negativas" };
    if (Math.abs(input.acceptedQty + input.rejectedQty - input.deliveredQty) > EPS) {
      return { ok: false, error: "Aceite + rejeitado deve ser igual ao entregue" };
    }
    const alreadyAccepted = previousReceipts
      .filter((row) => row.confirmed && row.purchaseOrderLineId === input.purchaseOrderLineId)
      .reduce((sum, row) => sum + row.acceptedQty, 0);
    if (alreadyAccepted + input.acceptedQty > orderLine.quantity + EPS) {
      return { ok: false, error: "A quantidade aceite acumulada excede a quantidade da OC" };
    }
  }
  return { ok: true };
}

export function validateShipment(
  orderLines: OrderLineSnapshot[],
  previousShipments: ShipmentLineSnapshot[],
  inputLines: Array<{ purchaseOrderLineId: string; quantity: number }>,
  previousReceipts: ReceiptLineSnapshot[] = [],
): { ok: true } | { ok: false; error: string } {
  const orderById = new Map(orderLines.map((line) => [line.id, line]));
  if (!inputLines.length) return { ok: false, error: "A expedição deve ter pelo menos uma linha" };
  if (new Set(inputLines.map((line) => line.purchaseOrderLineId)).size !== inputLines.length) {
    return { ok: false, error: "A mesma linha da OC não pode aparecer duas vezes na expedição" };
  }
  for (const input of inputLines) {
    const line = orderById.get(input.purchaseOrderLineId);
    if (!line) return { ok: false, error: "Linha de OC inválida" };
    if (!(input.quantity > 0)) return { ok: false, error: "Quantidade a expedir deve ser positiva" };
    const alreadyAccepted = previousReceipts
      .filter((row) => row.confirmed && row.purchaseOrderLineId === input.purchaseOrderLineId)
      .reduce((sum, row) => sum + row.acceptedQty, 0);
    const outstandingShipments = previousShipments
      .filter((row) => row.purchaseOrderLineId === input.purchaseOrderLineId && ["rascunho", "pronto", "expedido"].includes(row.shipmentStatus))
      .reduce((sum, row) => sum + row.quantity, 0);
    if (alreadyAccepted + outstandingShipments + input.quantity > line.quantity + EPS) {
      return { ok: false, error: "Aceite + cargas abertas + nova expedição excedem a quantidade da OC" };
    }
  }
  return { ok: true };
}

function utcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function calendarDelayDays(requiredByDate: string | null, finalReceiptDate: string | null): number | null {
  if (!requiredByDate || !finalReceiptDate) return null;
  return Math.max(0, utcDay(finalReceiptDate) - utcDay(requiredByDate));
}

export type SupplierPerformanceOrder = {
  orderId: string;
  requiredByDate: string | null;
  promisedDeliveryDate: string | null;
  supplierConfirmedAt: string | null;
  approvedAt: string | null;
  finalReceiptDate: string | null;
  fullyAccepted: boolean;
  orderedValue: number;
  acceptedValue: number;
  rejectedValue: number;
  completed: boolean;
};

export type SupplierPerformance = {
  score: number | null;
  scoreComponents: { otif: number | null; quality: number | null; confirmation: number | null };
  orderCount: number;
  completedOrderCount: number;
  // Fiabilidade do fornecedor: compara a recepção final com a data por ele prometida; se não
  // houver promessa, usa a data requerida como fallback. O cumprimento da necessidade da obra é
  // exposto separadamente para não confundir os dois conceitos.
  onTimeRatePct: number | null;
  inFullRatePct: number | null;
  otifPct: number | null;
  averageDelayDays: number | null;
  needByHitRatePct: number | null;
  averageNeedByDelayDays: number | null;
  acceptanceRatePct: number | null;
  rejectionRatePct: number | null;
  averageConfirmationHours: number | null;
};

export function computeSupplierPerformance(orders: SupplierPerformanceOrder[]): SupplierPerformance {
  const completed = orders.filter((order) => order.completed);
  const committed = completed
    .filter((order) => order.finalReceiptDate && (order.promisedDeliveryDate || order.requiredByDate))
    .map((order) => ({ ...order, commitmentDate: order.promisedDeliveryDate ?? order.requiredByDate! }));
  const needByTimed = completed.filter((order) => order.requiredByDate && order.finalReceiptDate);
  const onTimeCount = committed.filter((order) => calendarDelayDays(order.commitmentDate, order.finalReceiptDate) === 0).length;
  const needByOnTimeCount = needByTimed.filter((order) => calendarDelayDays(order.requiredByDate, order.finalReceiptDate) === 0).length;
  const inFullCount = completed.filter((order) => order.fullyAccepted).length;
  const otifDenominator = committed;
  const otifCount = otifDenominator.filter((order) => order.fullyAccepted && calendarDelayDays(order.commitmentDate, order.finalReceiptDate) === 0).length;
  const delays = committed.map((order) => calendarDelayDays(order.commitmentDate, order.finalReceiptDate) ?? 0);
  const needByDelays = needByTimed.map((order) => calendarDelayDays(order.requiredByDate, order.finalReceiptDate) ?? 0);
  const deliveredValue = orders.reduce((sum, order) => sum + order.acceptedValue + order.rejectedValue, 0);
  const acceptedValue = orders.reduce((sum, order) => sum + order.acceptedValue, 0);
  const rejectedValue = orders.reduce((sum, order) => sum + order.rejectedValue, 0);
  const confirmationHours = orders
    .filter((order) => order.approvedAt && order.supplierConfirmedAt)
    .map((order) => Math.max(0, (new Date(order.supplierConfirmedAt!).getTime() - new Date(order.approvedAt!).getTime()) / 3_600_000));

  const onTimeRatePct = committed.length ? (onTimeCount / committed.length) * 100 : null;
  const inFullRatePct = completed.length ? (inFullCount / completed.length) * 100 : null;
  const otifPct = otifDenominator.length ? (otifCount / otifDenominator.length) * 100 : null;
  const averageDelayDays = delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null;
  const needByHitRatePct = needByTimed.length ? (needByOnTimeCount / needByTimed.length) * 100 : null;
  const averageNeedByDelayDays = needByDelays.length ? needByDelays.reduce((sum, value) => sum + value, 0) / needByDelays.length : null;
  const acceptanceRatePct = deliveredValue > EPS ? (acceptedValue / deliveredValue) * 100 : null;
  const rejectionRatePct = deliveredValue > EPS ? (rejectedValue / deliveredValue) * 100 : null;
  const averageConfirmationHours = confirmationHours.length ? confirmationHours.reduce((sum, value) => sum + value, 0) / confirmationHours.length : null;
  const confirmationScore = averageConfirmationHours == null ? null
    : averageConfirmationHours <= 4 ? 100
      : averageConfirmationHours <= 24 ? 90
        : averageConfirmationHours <= 48 ? 75
          : averageConfirmationHours <= 72 ? 60
            : Math.max(0, 60 - (averageConfirmationHours - 72) * 0.5);
  const scoreParts = [
    otifPct == null ? null : { value: otifPct, weight: 0.6 },
    acceptanceRatePct == null ? null : { value: acceptanceRatePct, weight: 0.3 },
    confirmationScore == null ? null : { value: confirmationScore, weight: 0.1 },
  ].filter((part): part is { value: number; weight: number } => part != null);
  const totalWeight = scoreParts.reduce((sum, part) => sum + part.weight, 0);
  const score = totalWeight > 0 ? scoreParts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight : null;

  return {
    score,
    scoreComponents: { otif: otifPct, quality: acceptanceRatePct, confirmation: confirmationScore },
    orderCount: orders.length,
    completedOrderCount: completed.length,
    onTimeRatePct,
    inFullRatePct,
    otifPct,
    averageDelayDays,
    needByHitRatePct,
    averageNeedByDelayDays,
    acceptanceRatePct,
    rejectionRatePct,
    averageConfirmationHours,
  };
}
