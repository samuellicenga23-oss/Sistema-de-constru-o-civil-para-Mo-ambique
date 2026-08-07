import { request } from "./http";

export type QuoteRequestStatus = "enviado" | "respondido" | "aceite" | "recusado" | "expirado" | "cancelado";

export type QuoteRequestLine = {
  id: string;
  quoteRequestId: string;
  kind: "material" | "labour" | "equipment";
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  currency: string;
  supplierLineNotes: string | null;
  sortOrder: number;
};

export type SupplierAccount = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
};

export type SupplierPortalCompany = { companyId: string; companyName: string };

export type SupplierQuoteRequest = {
  id: string;
  companyId: string;
  companyName: string;
  supplierId: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  message: string | null;
  deadlineDate: string | null;
  status: QuoteRequestStatus;
  supplierNotes: string | null;
  respondedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export type SupplierQuoteRequestDetail = SupplierQuoteRequest & { lines: QuoteRequestLine[] };

export type SupplierQuoteResponseLine = { id: string; unitCost: number; notes?: string };

export const supplierPortalAuthApi = {
  me: () => request<SupplierAccount>("/supplier/auth/me"),
  login: (email: string, password: string) => request<SupplierAccount>("/supplier/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/supplier/auth/logout", { method: "POST" }),
  acceptInvite: (token: string, password: string) =>
    request<SupplierAccount>("/supplier/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, password }) }),
};

export const supplierPortalApi = {
  companies: () => request<SupplierPortalCompany[]>("/supplier/companies"),
  quoteRequests: () => request<SupplierQuoteRequest[]>("/supplier/quote-requests"),
  quoteRequest: (id: string) => request<SupplierQuoteRequestDetail>(`/supplier/quote-requests/${id}`),
  respond: (id: string, data: { supplierNotes?: string; lines: SupplierQuoteResponseLine[] }) =>
    request<SupplierQuoteRequest>(`/supplier/quote-requests/${id}/respond`, { method: "POST", body: JSON.stringify(data) }),
};
