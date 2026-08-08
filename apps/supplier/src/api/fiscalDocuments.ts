import { request } from "./http";

export type SupplierFiscalFacts = { invoiceNumber?: string | null; supplierNuit?: string | null; buyerNuit?: string | null; issueDate?: string | null; dueDate?: string | null; currency?: "MZN" | "USD" | null; subtotal?: number | null; vatRate?: number | null; vatAmount?: number | null; totalAmount?: number | null; atcud?: string | null; qrCodeText?: string | null };
export type SupplierFiscalDocument = { id: string; version: number; status: "carregado"|"extraido"|"requer_revisao"|"validado"|"rejeitado"; originalName: string; sha256: string; extractionProvider: string|null; extractedData: SupplierFiscalFacts|null; reviewedData: SupplierFiscalFacts|null; extractionMessage: string|null; rejectionReason: string|null; createdAt: string };
function body(file: File) { const form = new FormData(); form.append("file", file); return form; }
export const supplierFiscalDocumentsApi = {
  list: (invoiceId: string) => request<SupplierFiscalDocument[]>(`/supplier/invoices/${invoiceId}/fiscal-documents`),
  upload: (invoiceId: string, file: File) => request<SupplierFiscalDocument>(`/supplier/invoices/${invoiceId}/fiscal-documents`, { method: "POST", body: body(file) }),
  extract: (id: string) => request<SupplierFiscalDocument>(`/supplier/fiscal-documents/${id}/extract`, { method: "POST" }),
  saveFacts: (id: string, facts: SupplierFiscalFacts) => request<SupplierFiscalDocument>(`/supplier/fiscal-documents/${id}/facts`, { method: "PUT", body: JSON.stringify(facts) }),
  fileUrl: (id: string) => `/api/supplier/fiscal-documents/${id}/file`,
};
