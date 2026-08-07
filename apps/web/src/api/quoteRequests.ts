import { request } from "./http";

export type QuoteRequestStatus = "enviado" | "respondido" | "aceite" | "recusado" | "expirado" | "cancelado";
export type QuoteRequestLineKind = "material" | "labour" | "equipment";

export type QuoteRequestLine = {
  id: string;
  quoteRequestId: string;
  kind: QuoteRequestLineKind;
  materialId: string | null;
  labourCategoryId: string | null;
  equipmentId: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  currency: string;
  supplierLineNotes: string | null;
  sortOrder: number;
};

export type QuoteRequest = {
  id: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  projectId: string | null;
  projectName: string | null;
  createdByUserId: string | null;
  title: string;
  message: string | null;
  deadlineDate: string | null;
  status: QuoteRequestStatus;
  supplierNotes: string | null;
  respondedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export type QuoteRequestDetail = QuoteRequest & { lines: QuoteRequestLine[] };

export type QuoteRequestLineInput = { kind: QuoteRequestLineKind; resourceId: string; quantity?: number };

export type QuoteRequestInput = {
  supplierId: string;
  projectId?: string | null;
  title: string;
  message?: string;
  deadlineDate?: string | null;
  lines: QuoteRequestLineInput[];
};

export const quoteRequestsApi = {
  inviteSupplier: (supplierId: string, data: { email: string; name?: string }) =>
    request<{ ok: true; alreadyActive: boolean; supplierAccountId: string }>(`/suppliers/${supplierId}/invite`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  list: () => request<QuoteRequest[]>("/quote-requests"),
  get: (id: string) => request<QuoteRequestDetail>(`/quote-requests/${id}`),
  create: (data: QuoteRequestInput) => request<QuoteRequest>("/quote-requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) => request<QuoteRequest>(`/quote-requests/${id}/cancel`, { method: "POST" }),
  accept: (id: string) => request<QuoteRequest>(`/quote-requests/${id}/accept`, { method: "POST" }),
};
