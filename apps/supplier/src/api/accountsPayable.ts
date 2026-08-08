import { request } from "./http";

export type SupplierInvoice = {
  id: string;
  purchaseOrderId: string;
  projectId: string;
  projectName?: string;
  companyName?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  status: "rascunho" | "submetida" | "em_revisao" | "divergente" | "aprovada" | "rejeitada" | "parcialmente_paga" | "paga" | "cancelada";
  currency: string;
  totalAmount: string;
  transportCost: string;
  ivaRate: string;
  matchStatus: string;
  rejectionReason?: string | null;
  balance: { grossAmount: number; credited: number; netPayable: number; paid: number; outstanding: number; status: string };
  lines?: Array<{ id: string; purchaseOrderLineId: string; materialId: string; materialName: string; quantity: string; unitCost: string; lineTotal: string }>;
  creditNotes?: Array<{ id: string; creditNumber: string; amount: string; status: string; reason: string }>;
};

export type SupplierGoodsReturn = {
  id: string;
  reference: string;
  quantity: string;
  status: "rascunho" | "expedida" | "recebida_fornecedor" | "cancelada";
  returnDate: string | null;
  reason: string | null;
  trackingReference: string | null;
  supplierConfirmedAt: string | null;
};

export type SupplierNcr = {
  ncr: {
    id: string;
    reference: string;
    purchaseOrderId: string;
    rejectedQty: string;
    status: string;
    description: string;
    resolutionType: "substituicao" | "nota_credito" | "devolucao" | "aceite_com_desconto" | "outro" | null;
    supplierResponse: string | null;
    proposedReplacementQty: string | null;
    proposedCreditAmount: string | null;
  };
  materialName: string;
  companyName: string;
  projectName: string;
  returns: SupplierGoodsReturn[];
};

export type InvoicingContext = {
  order: { id: string; ivaRate: string; transportCost: string; requiredByDate: string | null };
  supplierName: string;
  companyName: string;
  projectName: string;
  transportInvoiceable: number;
  lines: Array<{ id: string; materialId: string; description?: string; orderedQty: number; unitCost: number; currency: string; acceptedQty: number; alreadyInvoicedQty: number; invoiceableQty: number }>;
};

export const supplierAccountsPayableApi = {
  invoicingContext: (orderId: string) => request<InvoicingContext>(`/supplier/purchase-orders/${orderId}/invoicing-context`),
  invoices: () => request<SupplierInvoice[]>("/supplier/invoices"),
  invoice: (id: string) => request<SupplierInvoice>(`/supplier/invoices/${id}`),
  createInvoice: (orderId: string, data: {
    invoiceNumber: string;
    issueDate: string;
    dueDate?: string | null;
    ivaRate: number;
    transportCost: number;
    notes?: string;
    lines: Array<{ purchaseOrderLineId: string; quantity: number; unitCost: number }>;
  }) => request<SupplierInvoice>(`/supplier/purchase-orders/${orderId}/invoices`, { method: "POST", body: JSON.stringify(data) }),
  createCreditNote: (invoiceId: string, data: { creditNumber: string; issueDate: string; amount: number; reason: string; nonconformityId?: string | null }) => request<{ id: string }>(`/supplier/invoices/${invoiceId}/credit-notes`, { method: "POST", body: JSON.stringify(data) }),
  nonconformities: () => request<SupplierNcr[]>("/supplier/nonconformities"),
  respondNcr: (id: string, data: { resolutionType: "substituicao" | "nota_credito" | "devolucao" | "aceite_com_desconto" | "outro"; replacementQty?: number; creditAmount?: number; response: string }) => request<SupplierNcr["ncr"]>(`/supplier/nonconformities/${id}/respond`, { method: "POST", body: JSON.stringify(data) }),
  confirmReturn: (id: string) => request<{ id: string; status: string }>(`/supplier/goods-returns/${id}/confirm`, { method: "POST" }),
};
