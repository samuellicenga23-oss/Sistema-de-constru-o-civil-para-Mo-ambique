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
  status: "rascunho" | "aprovado" | "recebido" | "cancelado";
  orderDate: string;
  requiredByDate: string | null;
  scheduleTaskId: string | null;
  notes: string | null;
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
  supplierId: string | null;
  supplierName: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  suggestedScheduleTaskId: string | null;
  suggestedScheduleTaskName: string | null;
  requiredByDate: string | null;
};

export type ProcurementPlan = {
  documentId: string;
  currency: string;
  requiredValue: number;
  shortageValue: number;
  coveragePercent: number;
  requirements: ProcurementRequirement[];
  missingCompositionItems: Array<{ code: string | null; description: string; phase: string }>;
};

export const purchasingApi = {
  listOrders: (projectId: string) => request<PurchaseOrder[]>(`/projects/${projectId}/purchase-orders`),
  createOrder: (projectId: string, data: PurchaseOrderInput) =>
    request<PurchaseOrder>(`/projects/${projectId}/purchase-orders`, { method: "POST", body: JSON.stringify(data) }),
  updateOrderStatus: (id: string, status: PurchaseOrder["status"]) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  deleteOrder: (id: string) => request<{ ok: true }>(`/purchase-orders/${id}`, { method: "DELETE" }),

  listStockMovements: (projectId: string) => request<StockMovement[]>(`/projects/${projectId}/stock-movements`),
  createStockMovement: (projectId: string, data: StockMovementInput) =>
    request<StockMovement>(`/projects/${projectId}/stock-movements`, { method: "POST", body: JSON.stringify(data) }),
  deleteStockMovement: (id: string) => request<{ ok: true }>(`/stock-movements/${id}`, { method: "DELETE" }),
  stockSummary: (projectId: string) => request<StockSummaryLine[]>(`/projects/${projectId}/stock-summary`),
  procurementPlan: (projectId: string) => request<ProcurementPlan>(`/projects/${projectId}/procurement-plan`),
};
