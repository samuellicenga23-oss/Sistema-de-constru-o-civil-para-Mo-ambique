import { request } from "./http";

export type FiscalFacts = {
  invoiceNumber?: string | null; supplierNuit?: string | null; buyerNuit?: string | null; issueDate?: string | null; dueDate?: string | null;
  currency?: "MZN" | "USD" | null; subtotal?: number | null; vatRate?: number | null; vatAmount?: number | null; totalAmount?: number | null; atcud?: string | null; qrCodeText?: string | null;
};
export type FiscalDocument = {
  id: string; supplierInvoiceId: string; version: number; status: "carregado" | "extraido" | "requer_revisao" | "validado" | "rejeitado";
  originalName: string; mimeType: string; fileSizeBytes: number; sha256: string; extractionProvider: string | null; extractionConfidence: string | null;
  extractedData: FiscalFacts | null; reviewedData: FiscalFacts | null; extractionMessage: string | null; validationSnapshot: { status?: string; hardBlocks?: string[]; warnings?: string[]; checks?: unknown[] } | null;
  rejectionReason: string | null; createdAt: string;
};
export type PaymentRequest = {
  id: string; supplierInvoiceId: string; reference: string; status: "rascunho" | "submetido" | "aprovado" | "rejeitado" | "executado" | "cancelado";
  amount: string; currency: string; requestedPaymentDate: string | null; method: string; payeeBankName: string | null; payeeAccountName: string | null; payeeAccountNumber: string | null;
  reason: string | null; approvedAt: string | null; rejectionReason: string | null; executionDate: string | null; executionReference: string | null; executionProofOriginalName: string | null;
};
export type BankTransaction = { id: string; status: string; transactionDate: string; valueDate: string | null; amount: string; currency: string; description: string | null; reference: string | null; counterparty: string | null };
export type ReconciliationView = {
  transactions: BankTransaction[];
  paymentRequests: Array<{ request: PaymentRequest; invoiceNumber: string; supplierName: string }>;
  suggestions: Array<{ transactionId: string; matches: Array<{ paymentRequestId: string; score: number; eligible: boolean; reasons: string[]; reference: string; supplierName: string; invoiceNumber: string; status: string }> }>;
};

function fileBody(file: File, fields?: Record<string, string | undefined>) { const body = new FormData(); for (const [key, value] of Object.entries(fields ?? {})) if (value) body.append(key, value); body.append("file", file); return body; }

export const procurementFiscalControlApi = {
  fiscalDocuments: (invoiceId: string) => request<FiscalDocument[]>(`/supplier-invoices/${invoiceId}/fiscal-documents`),
  uploadFiscal: (invoiceId: string, file: File) => request<FiscalDocument>(`/supplier-invoices/${invoiceId}/fiscal-documents`, { method: "POST", body: fileBody(file) }),
  extractFiscal: (id: string) => request<FiscalDocument>(`/fiscal-documents/${id}/extract`, { method: "POST" }),
  saveFacts: (id: string, facts: FiscalFacts) => request<FiscalDocument>(`/fiscal-documents/${id}/facts`, { method: "PUT", body: JSON.stringify(facts) }),
  validateFiscal: (id: string) => request<{ document: FiscalDocument; validation: { status: string; hardBlocks: string[]; warnings: string[] } }>(`/fiscal-documents/${id}/validate`, { method: "POST" }),
  rejectFiscal: (id: string, reason: string) => request<FiscalDocument>(`/fiscal-documents/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  fiscalFileUrl: (id: string) => `/api/fiscal-documents/${id}/file`,
  paymentRequests: (invoiceId: string) => request<PaymentRequest[]>(`/supplier-invoices/${invoiceId}/payment-requests`),
  createPaymentRequest: (invoiceId: string, data: { amount: number; requestedPaymentDate?: string; method?: string; payeeBankName?: string; payeeAccountName?: string; payeeAccountNumber?: string; reason: string; notes?: string }) => request<PaymentRequest>(`/supplier-invoices/${invoiceId}/payment-requests`, { method: "POST", body: JSON.stringify(data) }),
  submitPayment: (id: string) => request<PaymentRequest>(`/payment-requests/${id}/submit`, { method: "POST" }),
  approvePayment: (id: string, overrideReason?: string) => request<PaymentRequest>(`/payment-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ overrideReason }) }),
  rejectPayment: (id: string, reason: string) => request<PaymentRequest>(`/payment-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  executePayment: (id: string, data: { executionDate: string; reference?: string; overrideReason?: string }) => request<{ request: PaymentRequest }>(`/payment-requests/${id}/execute`, { method: "POST", body: JSON.stringify(data) }),
  uploadPaymentProof: (id: string, file: File) => request<PaymentRequest>(`/payment-requests/${id}/proof`, { method: "POST", body: fileBody(file) }),
  paymentProofUrl: (id: string) => `/api/payment-requests/${id}/proof`,
  bankReconciliation: (projectId: string) => request<ReconciliationView>(`/projects/${projectId}/bank-reconciliation`),
  importBankStatement: (projectId: string, file: File, data: { bankName: string; accountLabel?: string; currency: string }) => request<{ import: unknown; inserted: number }>(`/projects/${projectId}/bank-statements`, { method: "POST", body: fileBody(file, data) }),
  reconcile: (transactionId: string, paymentRequestId: string, notes?: string, overrideReason?: string) => request(`/bank-transactions/${transactionId}/reconcile`, { method: "POST", body: JSON.stringify({ paymentRequestId, notes, overrideReason }) }),
  ignoreTransaction: (id: string) => request(`/bank-transactions/${id}/ignore`, { method: "POST" }),
};
