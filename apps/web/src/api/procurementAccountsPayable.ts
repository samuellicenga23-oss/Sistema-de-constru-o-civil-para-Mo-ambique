import { request } from "./http";

export type SupplierInvoiceStatus = "rascunho" | "submetida" | "em_revisao" | "divergente" | "aprovada" | "rejeitada" | "parcialmente_paga" | "paga" | "cancelada";
export type MatchResult = {
  hardBlocks: string[];
  softVariances: string[];
  exactMatch: boolean;
  canApprove: boolean;
  canApproveWithVariance: boolean;
  subtotal: number;
  transport: number;
  vatAmount: number;
  total: number;
  lineMatches: Array<{
    purchaseOrderLineId: string;
    orderedQty: number;
    acceptedQty: number;
    previouslyInvoicedQty: number;
    availableToInvoiceQty: number;
    invoicedQty: number;
    poUnitCost: number;
    invoiceUnitCost: number;
    quantityStatus: string;
    priceStatus: string;
  }>;
};
export type PayableBalance = { grossAmount: number; credited: number; netPayable: number; paid: number; outstanding: number; overpaid: number; status: string };
export type SupplierInvoiceSummary = {
  id: string;
  projectId: string;
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  status: SupplierInvoiceStatus;
  currency: string;
  totalAmount: string;
  matchStatus: string;
  balance: PayableBalance;
};
export type SupplierInvoiceDetail = SupplierInvoiceSummary & {
  ivaRate: string;
  transportCost: string;
  subtotal: string;
  vatAmount: string;
  varianceReason: string | null;
  rejectionReason: string | null;
  lines: Array<{ id: string; purchaseOrderLineId: string; materialId: string; materialName: string; quantity: string; unitCost: string; lineTotal: string }>;
  payments: Array<{ id: string; amount: string; paymentDate: string; method: string; reference: string | null }>;
  creditNotes: Array<{ id: string; creditNumber: string; issueDate: string; amount: string; reason: string; status: "submetida" | "aceite" | "rejeitada" | "cancelada" }>;
  currentMatch: MatchResult;
};

export type ProcurementGoodsReturn = {
  id: string;
  reference: string;
  quantity: string;
  status: "rascunho" | "expedida" | "recebida_fornecedor" | "cancelada";
  returnDate: string | null;
  reason: string | null;
  trackingReference: string | null;
  supplierConfirmedAt: string | null;
};

export type ProcurementNcr = {
  ncr: {
    id: string;
    reference: string;
    purchaseOrderId: string;
    materialId: string;
    rejectedQty: string;
    status: "aberta" | "aguarda_fornecedor" | "solucao_proposta" | "aguarda_substituicao" | "aguarda_credito" | "devolucao_pendente" | "resolvida" | "cancelada";
    description: string;
    resolutionType: "substituicao" | "nota_credito" | "devolucao" | "aceite_com_desconto" | "outro" | null;
    proposedReplacementQty: string | null;
    proposedCreditAmount: string | null;
    supplierResponse: string | null;
    buyerResolutionNotes: string | null;
  };
  supplierName: string;
  materialName: string;
  returns: ProcurementGoodsReturn[];
};

export const accountsPayableApi = {
  invoices: (projectId: string) => request<SupplierInvoiceSummary[]>(`/projects/${projectId}/supplier-invoices`),
  invoice: (id: string) => request<SupplierInvoiceDetail>(`/supplier-invoices/${id}`),
  review: (id: string) => request<{ status: SupplierInvoiceStatus; match: MatchResult }>(`/supplier-invoices/${id}/review`, { method: "POST" }),
  approve: (id: string, data: { varianceReason?: string; buyerNotes?: string }) => request<{ status: SupplierInvoiceStatus; match: MatchResult }>(`/supplier-invoices/${id}/approve`, { method: "POST", body: JSON.stringify(data) }),
  reject: (id: string, reason: string) => request<{ status: SupplierInvoiceStatus }>(`/supplier-invoices/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  pay: (id: string, data: { amount: number; paymentDate: string; method?: string; reference?: string; notes?: string }) => request<{ balance: PayableBalance }>(`/supplier-invoices/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
  reviewCredit: (id: string, decision: "aceite" | "rejeitada", notes?: string) => request<{ credit: unknown; balance: PayableBalance | null }>(`/supplier-invoice-credit-notes/${id}/review`, { method: "POST", body: JSON.stringify({ decision, notes }) }),
  nonconformities: (projectId: string) => request<ProcurementNcr[]>(`/projects/${projectId}/nonconformities`),
  acceptSolution: (id: string) => request<ProcurementNcr["ncr"]>(`/nonconformities/${id}/accept-solution`, { method: "POST" }),
  resolveNcr: (id: string, notes: string) => request<ProcurementNcr["ncr"]>(`/nonconformities/${id}/resolve`, { method: "POST", body: JSON.stringify({ notes }) }),
  createReturn: (id: string, data: { quantity: number; returnDate: string; reason: string; trackingReference?: string }) => request<{ id: string; reference: string }>(`/nonconformities/${id}/returns`, { method: "POST", body: JSON.stringify(data) }),
};
