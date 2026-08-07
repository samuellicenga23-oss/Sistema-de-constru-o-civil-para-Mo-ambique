import { request } from "./http";

export type AdminSupplierAccount = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  activated: boolean;
  createdAt: string;
  companies: Array<{ companyId: string; companyName: string }>;
  quoteRequestsByStatus: Record<string, number>;
};

export type AdminQuoteRequestStats = { byStatus: Record<string, number>; activeFeeds: number };

export const adminSuppliersApi = {
  listAccounts: () => request<AdminSupplierAccount[]>("/admin/supplier-accounts"),
  resendInvite: (id: string) => request<{ ok: true }>(`/admin/supplier-accounts/${id}/resend-invite`, { method: "POST" }),
  quoteRequestStats: () => request<AdminQuoteRequestStats>("/admin/quote-requests/stats"),
};
