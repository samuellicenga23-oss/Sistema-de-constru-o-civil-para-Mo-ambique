import { request } from "./http";

export type ProcurementRequisitionStatus =
  | "rascunho" | "submetida" | "aprovada" | "em_cotacao" | "adjudicada" | "comprada" | "fechada" | "cancelada";
export type ProcurementRfqStatus = "rascunho" | "aberta" | "em_avaliacao" | "adjudicada" | "cancelada" | "expirada";

export type PurchaseRequisitionLine = {
  id: string;
  requisitionId: string;
  materialId: string;
  materialName: string;
  unit: string;
  requestedQty: string;
  specification: string | null;
  notes: string | null;
  sourceScheduleTaskId: string | null;
  sortOrder: number;
};

export type PurchaseRequisition = {
  id: string;
  companyId: string;
  projectId: string;
  reference: string;
  status: ProcurementRequisitionStatus;
  source: "manual" | "plano_compras" | "cronograma";
  priority: "baixa" | "normal" | "alta" | "urgente";
  requiredByDate: string | null;
  scheduleTaskId: string | null;
  justification: string | null;
  notes: string | null;
  createdByUserId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PurchaseRequisitionLine[];
};

export type ProcurementRfq = {
  id: string;
  companyId: string;
  projectId: string;
  requisitionId: string | null;
  reference: string;
  title: string;
  message: string | null;
  status: ProcurementRfqStatus;
  deadlineDate: string | null;
  deliveryLocation: string | null;
  requiredByDate: string | null;
  currency: string;
  allowPartialQuotes: boolean;
  allowPartialAward: boolean;
  paymentRequirements: string | null;
  commercialTerms: string | null;
  regionalNote: string | null;
  invitationCount?: number;
  responseCount?: number;
  createdAt: string;
};

export type ProcurementRfqLine = {
  id: string;
  rfqId: string;
  requisitionLineId: string | null;
  materialId: string;
  materialName: string;
  materialUnit: string;
  description: string;
  unit: string | null;
  quantity: string;
  specification: string | null;
  requiredByDate: string | null;
};

export type SupplierQuoteComparison = {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  subtotal: number;
  transportCost: number;
  total: number;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  validUntil: string | null;
  lineCoveragePct: number;
  quantityCoveragePct: number;
  isCheapest: boolean;
  isFastest: boolean;
  isExpired: boolean;
};

export type SubmittedSupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  transportCost: number;
  transportIncluded: boolean;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  validUntil: string | null;
  version: number;
  status: "submetida";
  lines: Array<{
    rfqLineId: string;
    quantityOffered: number;
    unitCost: number;
    discountPct: number;
    leadTimeDays: number | null;
    available: boolean;
  }>;
};

export type ProcurementComparison = {
  rfq: ProcurementRfq;
  lines: ProcurementRfqLine[];
  comparison: SupplierQuoteComparison[];
  quotes: SubmittedSupplierQuote[];
};

export const procurementApi = {
  requisitions: (projectId: string) => request<PurchaseRequisition[]>(`/projects/${projectId}/procurement/requisitions`),
  createRequisition: (projectId: string, data: {
    priority?: PurchaseRequisition["priority"];
    requiredByDate?: string | null;
    scheduleTaskId?: string | null;
    justification?: string;
    notes?: string;
    source?: PurchaseRequisition["source"];
    lines: Array<{ materialId: string; quantity: number; specification?: string; notes?: string; sourceScheduleTaskId?: string | null }>;
  }) => request<PurchaseRequisition>(`/projects/${projectId}/procurement/requisitions`, { method: "POST", body: JSON.stringify(data) }),
  submitRequisition: (id: string) => request<PurchaseRequisition>(`/procurement/requisitions/${id}/submit`, { method: "POST" }),
  approveRequisition: (id: string) => request<PurchaseRequisition>(`/procurement/requisitions/${id}/approve`, { method: "POST" }),
  createRfq: (requisitionId: string, data: {
    title: string;
    message?: string;
    supplierIds: string[];
    deadlineDate: string;
    deliveryLocation?: string;
    requiredByDate?: string | null;
    allowPartialQuotes?: boolean;
    allowPartialAward?: boolean;
    paymentRequirements?: string;
    commercialTerms?: string;
    singleSourceJustification?: string;
  }) => request<ProcurementRfq>(`/procurement/requisitions/${requisitionId}/rfqs`, { method: "POST", body: JSON.stringify(data) }),
  rfqs: (projectId: string) => request<ProcurementRfq[]>(`/projects/${projectId}/procurement/rfqs`),
  comparison: (rfqId: string) => request<ProcurementComparison>(`/procurement/rfqs/${rfqId}/comparison`),
  award: (rfqId: string, data: {
    decisionReason: string;
    allocations: Array<{ rfqLineId: string; quoteId: string; quantityAwarded: number }>;
  }) => request<{ rfqId: string; status: "adjudicada"; purchaseOrders: Array<{ id: string; supplierId: string }> }>(`/procurement/rfqs/${rfqId}/award`, { method: "POST", body: JSON.stringify(data) }),
};
