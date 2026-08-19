import { request } from "./http";

export type SupplierConfirmationStatus = "pendente" | "confirmado" | "alteracao_solicitada" | "recusado";
export type FulfillmentStatus = "aguarda_confirmacao" | "confirmado" | "em_preparacao" | "pronto_expedir" | "em_transito" | "parcialmente_recebido" | "recebido" | "fechado";
export type ShipmentStatus = "rascunho" | "pronto" | "expedido" | "entregue" | "cancelado";

export type SupplierOrderLine = {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  quantity: string;
  unitCost: string;
  currency: string;
};

export type SupplierOrder = {
  id: string;
  projectId: string;
  supplierId: string;
  companyName: string;
  projectName: string;
  supplierName: string;
  status: "rascunho" | "aprovado" | "recebido" | "cancelado";
  orderDate: string;
  requiredByDate: string | null;
  transportCost: string;
  supplierConfirmationStatus: SupplierConfirmationStatus;
  fulfillmentStatus: FulfillmentStatus;
  promisedDeliveryDate: string | null;
  supplierResponseNotes: string | null;
  supplierConfirmedAt: string | null;
  summary: {
    status: FulfillmentStatus;
    fillRatePct: number;
    rejectionRatePct: number;
    fullyAccepted: boolean;
    lines: Array<{ purchaseOrderLineId: string; orderedQty: number; dispatchedQty: number; acceptedQty: number; rejectedQty: number; remainingToDispatchQty: number; remainingToReceiveQty: number }>;
  };
  lines?: SupplierOrderLine[];
  shipments?: Array<{ id: string; reference: string; status: ShipmentStatus; expectedDeliveryDate: string | null; trackingReference: string | null; createdAt: string; lines: Array<{ id: string; shipmentId: string; purchaseOrderLineId: string; quantity: string }> }>;
};

export type SupplierPerformance = {
  score: number | null;
  scorecard?: { status: "ok" | "insufficient"; label: string; score: number | null };
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

export const fulfillmentApi = {
  orders: () => request<SupplierOrder[]>("/supplier/purchase-orders"),
  order: (id: string) => request<SupplierOrder>(`/supplier/purchase-orders/${id}`),
  confirm: (id: string, data: { promisedDeliveryDate: string; notes?: string }) => request<SupplierOrder>(`/supplier/purchase-orders/${id}/confirm`, { method: "POST", body: JSON.stringify(data) }),
  requestChange: (id: string, reason: string) => request<SupplierOrder>(`/supplier/purchase-orders/${id}/request-change`, { method: "POST", body: JSON.stringify({ reason }) }),
  decline: (id: string, reason: string) => request<SupplierOrder>(`/supplier/purchase-orders/${id}/decline`, { method: "POST", body: JSON.stringify({ reason }) }),
  preparing: (id: string) => request<SupplierOrder>(`/supplier/purchase-orders/${id}/preparing`, { method: "POST" }),
  createShipment: (id: string, data: {
    expectedDeliveryDate?: string | null;
    carrier?: string;
    vehiclePlate?: string;
    driverName?: string;
    driverPhone?: string;
    trackingReference?: string;
    notes?: string;
    lines: Array<{ purchaseOrderLineId: string; quantity: number }>;
  }) => request<{ id: string; reference: string; status: ShipmentStatus }>(`/supplier/purchase-orders/${id}/shipments`, { method: "POST", body: JSON.stringify(data) }),
  ready: (shipmentId: string) => request<{ id: string; status: ShipmentStatus }>(`/supplier/shipments/${shipmentId}/ready`, { method: "POST" }),
  dispatch: (shipmentId: string) => request<{ id: string; status: ShipmentStatus }>(`/supplier/shipments/${shipmentId}/dispatch`, { method: "POST" }),
  cancelShipment: (shipmentId: string) => request<{ id: string; status: ShipmentStatus }>(`/supplier/shipments/${shipmentId}/cancel`, { method: "POST" }),
  performance: () => request<SupplierPerformance>("/supplier/performance"),
};
