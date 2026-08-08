import { request } from "./http";

export type PurchaseOrderLine = {
  id: string;
  purchaseOrderId: string;
  materialId: string;
  materialName: string;
  unit: string;
  quantity: string;
  unitCost: string;
  currency: string;
};

export type PurchaseOrder = {
  id: string;
  projectId: string;
  supplierId: string;
  supplierName: string;
  supplierContact: string | null;
  status: "rascunho" | "aprovado" | "recebido" | "cancelado";
  orderDate: string;
  requiredByDate: string | null;
  scheduleTaskId: string | null;
  notes: string | null;
  ivaRate: string;
  lines: PurchaseOrderLine[];
  createdAt: string;
};

export type PurchaseOrderLineInput = { materialId: string; quantity: number; unitCost: number; currency?: string };
export type PurchaseOrderInput = { supplierId: string; orderDate: string; requiredByDate?: string; scheduleTaskId?: string | null; notes?: string; lines: PurchaseOrderLineInput[] };

export type StockMovement = {
  id: string;
  projectId: string;
  materialId: string;
  materialName: string;
  type: "entrada" | "saida";
  quantity: string;
  unit: string;
  unitCost: string | null;
  currency: string | null;
  notes: string | null;
  purchaseOrderId: string | null;
  diaryEntryId: string | null;
  date: string;
  createdAt: string;
};

export type StockMovementInput = {
  materialId: string;
  type: "entrada" | "saida";
  quantity: number;
  unitCost?: number;
  currency?: string;
  notes?: string;
  date: string;
};

export type StockSummaryLine = { materialId: string; materialName: string; unit: string; balance: number; valueIn: number };

export type ProcurementRequirement = {
  materialId: string;
  materialName: string;
  unit: string;
  phases: { key: string; label: string; quantity: number }[];
  requiredQty: number;
  stockQty: number;
  consumedQty: number;
  orderedQty: number;
  shortageQty: number;
  suggestedOrderQty: number;
  purchaseQty: number | null;
  purchasePackageLabel: string | null;
  estimatedUnitCost: number;
  estimatedTotal: number;
  estimatedVat: number;
  estimatedTotalWithVat: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierContact: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  quotes: ProcurementQuote[];
  suggestedScheduleTaskId: string | null;
  suggestedScheduleTaskName: string | null;
  requiredByDate: string | null;
};

export type ProcurementQuote = {
  supplierId: string | null;
  supplierName: string;
  supplierContact: string | null;
  unitCost: number;
  estimatedSubtotal: number;
  estimatedVat: number;
  estimatedTotalWithVat: number;
  currency: string;
  zoneId: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  isReference: boolean;
};

export type RebarPurchaseLine = {
  diameterMm: number;
  scheduledWeightKg: number;
  weightPerMeterKg: number;
  requiredLengthM: number;
  commercialBarLengthM: number;
  barsToBuy: number;
  purchaseWeightKg: number;
  cuttingSurplusKg: number;
};

export type ProjectRebarPurchasePlan = {
  sourcePlantId: string;
  sourceFileName: string | null;
  commercialBarLengthM: number;
  lines: RebarPurchaseLine[];
  totalScheduledWeightKg: number;
  totalPurchaseWeightKg: number;
};

export type ProcurementPlan = {
  documentId: string;
  currency: string;
  ivaRate: number;
  requiredValue: number;
  shortageValue: number;
  shortageVat: number;
  shortageTotal: number;
  coveragePercent: number;
  requirements: ProcurementRequirement[];
  rebarPurchasePlan: ProjectRebarPurchasePlan | null;
  missingCompositionItems: Array<{ code: string | null; description: string; phase: string }>;
};

export const purchasingApi = {
  listOrders: (projectId: string) => request<PurchaseOrder[]>(`/projects/${projectId}/purchase-orders`),
  createOrder: (projectId: string, data: PurchaseOrderInput) =>
    request<PurchaseOrder>(`/projects/${projectId}/purchase-orders`, { method: "POST", body: JSON.stringify(data) }),
  createMaterialRequest: (
    projectId: string,
    data: { notes?: string; lines: Array<{ materialId: string; quantity: number }> },
  ) =>
    request<PurchaseOrder>(`/projects/${projectId}/material-requests`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateOrderStatus: (id: string, status: PurchaseOrder["status"]) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  deleteOrder: (id: string) => request<{ ok: true }>(`/purchase-orders/${id}`, { method: "DELETE" }),
  updateOrderLineCost: (lineId: string, unitCost: number) =>
    request<{ id: string }>(`/purchase-order-lines/${lineId}`, { method: "PUT", body: JSON.stringify({ unitCost }) }),
  updateOrderLine: (lineId: string, data: { unitCost?: number; quantity?: number }) =>
    request<PurchaseOrderLine>(`/purchase-order-lines/${lineId}`, { method: "PUT", body: JSON.stringify(data) }),

  listStockMovements: (projectId: string) => request<StockMovement[]>(`/projects/${projectId}/stock-movements`),
  createStockMovement: (projectId: string, data: StockMovementInput) =>
    request<StockMovement>(`/projects/${projectId}/stock-movements`, { method: "POST", body: JSON.stringify(data) }),
  deleteStockMovement: (id: string) => request<{ ok: true }>(`/stock-movements/${id}`, { method: "DELETE" }),
  stockSummary: (projectId: string) => request<StockSummaryLine[]>(`/projects/${projectId}/stock-summary`),
  procurementPlan: (projectId: string) => request<ProcurementPlan>(`/projects/${projectId}/procurement-plan`),
};
