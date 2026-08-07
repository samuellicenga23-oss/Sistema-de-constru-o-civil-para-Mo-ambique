import { request } from "./http";

export type AdminSupplierAccount = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  activated: boolean;
  createdAt: string;
  hasMarketplaceProfile?: boolean;
  companies: Array<{ companyId: string; companyName: string }>;
  quoteRequestsByStatus: Record<string, number>;
};

export type AdminQuoteRequestStats = { byStatus: Record<string, number>; activeFeeds: number };

export type CreateSupplierAccountInput = {
  name: string;
  email: string;
  phone?: string | null;
  zoneId?: string | null;
  password?: string;
  sendInvite?: boolean;
};

export const adminSuppliersApi = {
  listAccounts: () => request<AdminSupplierAccount[]>("/admin/supplier-accounts"),
  createAccount: (data: CreateSupplierAccountInput) =>
    request<{ id: string; temporaryPassword?: string }>("/admin/supplier-accounts", { method: "POST", body: JSON.stringify(data) }),
  resendInvite: (id: string) => request<{ ok: true }>(`/admin/supplier-accounts/${id}/resend-invite`, { method: "POST" }),
  resetPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/admin/supplier-accounts/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  patchAccount: (id: string, data: { isActive?: boolean; name?: string; phone?: string | null }) =>
    request<Pick<AdminSupplierAccount, "id" | "name" | "email" | "phone" | "isActive" | "activated">>(`/admin/supplier-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  quoteRequestStats: () => request<AdminQuoteRequestStats>("/admin/quote-requests/stats"),
};
