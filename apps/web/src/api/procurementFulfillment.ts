import { request } from "./http";

export type SupplierConfirmationStatus = "pendente" | "confirmado" | "alteracao_solicitada" | "recusado";
export type FulfillmentStatus = "aguarda_confirmacao" | "confirmado" | "em_preparacao" | "pronto_expedir" | "em_transito" | "parcialmente_recebido" | "recebido" | "fechado";
export type ShipmentStatus = "rascunho" | "pronto" | "expedido" | "entregue" | "cancelado";
export type GoodsReceiptStatus = "rascunho" | "confirmado" | "cancelado";

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

export type FulfillmentOrder = {
  id: string;
  projectId: string;
  supplierId: string;
  supplierName: string;
  status: "rascunho" | "aprovado" | "recebido" | "cancelado";
  orderDate: string;
  requiredByDate: string | null;
  supplierConfirmationStatus: SupplierConfirmationStatus;
  fulfillmentStatus: FulfillmentStatus;
  promisedDeliveryDate: string | null;
  supplierResponseNotes: string | null;
  supplierConfirmedAt: string | null;
  transportCost: string;
  summary: FulfillmentSummary;
};

export type PurchaseOrderShipment = {
  id: string;
  purchaseOrderId: string;
  reference: string;
  status: ShipmentStatus;
  expectedDeliveryDate: string | null;
  trackingReference: string | null;
  carrier: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  lines: Array<{ id: string; shipmentId: string; purchaseOrderLineId: string; quantity: string }>;
};

export type GoodsReceiptLine = {
  id: string;
  goodsReceiptId: string;
  purchaseOrderLineId: string;
  materialId: string;
  materialName: string;
  unit: string;
  deliveredQty: string;
  acceptedQty: string;
  rejectedQty: string;
  rejectionReason: string | null;
  conditionNotes: string | null;
  unitCost: string;
  currency: string;
};

export type GoodsReceipt = {
  id: string;
  projectId: string;
  purchaseOrderId: string;
  shipmentId: string | null;
  reference: string;
  status: GoodsReceiptStatus;
  receiptDate: string;
  deliveryNoteNumber: string | null;
  inspectionNotes: string | null;
  supplierName: string;
  lines: GoodsReceiptLine[];
};

export type FulfillmentOrderDetail = FulfillmentOrder & {
  lines: Array<{ id: string; materialId: string; materialName: string; unit: string; quantity: string; unitCost: string; currency: string }>;
  shipments: PurchaseOrderShipment[];
  receipts: GoodsReceipt[];
};

export type SupplierPerformance = {
  score: number | null;
  scoreComponents: { otif: number | null; quality: number | null; confirmation: number | null };
  orderCount: number;
  completedOrderCount: number;
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

export const procurementFulfillmentApi = {
  projectOrders: (projectId: string) => request<FulfillmentOrder[]>(`/projects/${projectId}/procurement/fulfillment`),
  order: (orderId: string) => request<FulfillmentOrderDetail>(`/purchase-orders/${orderId}/fulfillment`),
  receipts: (projectId: string) => request<GoodsReceipt[]>(`/projects/${projectId}/goods-receipts`),
  createReceipt: (orderId: string, data: {
    shipmentId?: string | null;
    receiptDate: string;
    deliveryNoteNumber?: string;
    inspectionNotes?: string;
    lines: Array<{ purchaseOrderLineId: string; deliveredQty: number; acceptedQty: number; rejectedQty: number; rejectionReason?: string; conditionNotes?: string }>;
  }) => request<GoodsReceipt>(`/purchase-orders/${orderId}/goods-receipts`, { method: "POST", body: JSON.stringify(data) }),
  confirmReceipt: (receiptId: string) => request<GoodsReceipt & { summary: FulfillmentSummary }>(`/goods-receipts/${receiptId}/confirm`, { method: "POST" }),
  cancelReceipt: (receiptId: string) => request<GoodsReceipt>(`/goods-receipts/${receiptId}/cancel`, { method: "POST" }),
  supplierPerformance: (supplierId: string, projectId?: string) => request<SupplierPerformance>(`/suppliers/${supplierId}/performance${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
};
