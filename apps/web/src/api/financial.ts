import { request } from "./http";

export type FinancialEntry = {
  id: string;
  projectId: string;
  type: "receita" | "despesa";
  category: string;
  description: string | null;
  amount: string;
  currency: string;
  dueDate: string | null;
  paidDate: string | null;
  status: "pendente" | "pago";
  sourceType: "purchase_order" | "supplier_invoice" | "measurement_certificate" | "invoice" | "practice_invoice" | null;
  sourceId: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type FinancialEntryInput = {
  type: "receita" | "despesa";
  category: string;
  description?: string;
  amount: number;
  currency?: string;
  dueDate?: string;
  paidDate?: string;
  status?: "pendente" | "pago";
};

export type FinancialSummary = {
  currency: string;
  valorContratado: number;
  valorRecebido: number;
  custoRealizado: number;
  contasAReceber: number;
  contasAPagar: number;
  compromissosCompra: number;
  saldo: number;
  margemRealizada: number;
  fluxoCaixaMensal: { month: string; receitas: number; despesas: number; saldo: number }[];
};

export type ProjectControl = {
  currency: string;
  basis: { approvedBudgetDocumentId: string | null; referenceDate: string; stockConsumptionEstimated: boolean };
  commercial: { contractedValue: number; certifiedValue: number; receivedValue: number; receivableValue: number };
  cost: { paidValue: number; committedValue: number; consumedStockValue: number; cashMargin: number };
  schedule: { expectedProgress: number; actualProgress: number; progressGap: number; plannedValue: number; executedValue: number };
  stock: Array<{ materialName: string; unit: string; balance: number; consumedQty: number; consumedValue: number; estimatedCost: boolean }>;
  alerts: Array<{ code: string; level: "critical" | "warning" | "info"; title: string; detail: string; href: string }>;
};

export type ProjectInvoice = {
  id: string; projectId: string; measurementCertificateId: string; invoiceNumber: string | null; clientName: string | null;
  issueDate: string | null; dueDate: string | null; status: "rascunho" | "emitida" | "parcial" | "paga" | "cancelada";
  grossAmount: string; ivaRate: string; retentionRate: string; retentionAmount: string; netAmount: string; currency: string;
  paidAmount: number; creditAmount: number; outstandingAmount: number;
  receipts: Array<{ id: string; amount: string; receivedDate: string; reference: string | null; proofOriginalName: string | null; proofUrl: string | null }>;
  creditNotes: Array<{ id: string; creditNumber: string; issueDate: string; amount: string; reason: string; status: "rascunho" | "emitida" | "cancelada" }>;
};
export type ProjectContract = { id: string; projectId: string; contractNumber: string; clientName: string; originalAmount: string; advanceAmount: string; retentionRate: string; currency: string; status: "rascunho" | "activo" | "concluido" | "cancelado"; approvedVariations: number; revisedAmount: number; variations: Array<{ id: string; title: string; amount: string; status: string }> };
export type ClientStatement = { currency: string; contract: { originalAmount: number; approvedVariations: number; revisedAmount: number; advanceAmount: number; retentionRate: number }; totals: { invoiced: number; credited: number; received: number; outstanding: number } };

export const financialApi = {
  list: (projectId: string) => request<FinancialEntry[]>(`/projects/${projectId}/financial-entries`),
  create: (projectId: string, data: FinancialEntryInput) =>
    request<FinancialEntry>(`/projects/${projectId}/financial-entries`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<FinancialEntryInput>) =>
    request<FinancialEntry>(`/financial-entries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/financial-entries/${id}`, { method: "DELETE" }),
  summary: (projectId: string) => request<FinancialSummary>(`/projects/${projectId}/financial-summary`),
  control: (projectId: string) => request<ProjectControl>(`/projects/${projectId}/control`),
  listInvoices: (projectId: string) => request<ProjectInvoice[]>(`/projects/${projectId}/invoices`),
  issueInvoice: (id: string, data: { invoiceNumber: string; issueDate: string; dueDate?: string; retentionRate?: number; notes?: string }) => request<ProjectInvoice>(`/invoices/${id}/issue`, { method: "PUT", body: JSON.stringify(data) }),
  addReceipt: (id: string, data: { amount: number; receivedDate: string; reference?: string; notes?: string }, idempotencyKey = crypto.randomUUID()) => request(`/invoices/${id}/receipts`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(data) }),
  uploadReceiptProof: (id: string, file: File) => { const body = new FormData(); body.append("file", file); return request(`/invoice-receipts/${id}/proof`, { method: "POST", body }); },
  createCreditNote: (id: string, data: { creditNumber: string; issueDate: string; amount: number; reason: string }) => request(`/invoices/${id}/credit-notes`, { method: "POST", body: JSON.stringify(data) }),
  issueCreditNote: (id: string) => request(`/credit-notes/${id}/issue`, { method: "PUT" }),
  invoicePdfUrl: (id: string) => `/api/invoices/${id}/export.pdf`,
  getContract: (projectId: string) => request<ProjectContract | null>(`/projects/${projectId}/contract`),
  saveContract: (projectId: string, data: { contractNumber: string; clientName: string; originalAmount: number; advanceAmount?: number; retentionRate?: number }) => request<ProjectContract>(`/projects/${projectId}/contract`, { method: "PUT", body: JSON.stringify(data) }),
  clientStatement: (projectId: string) => request<ClientStatement>(`/projects/${projectId}/client-statement`),
};
