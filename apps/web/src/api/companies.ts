import { request, ApiError } from "./http";

export type Subscription = {
  id: string;
  companyId: string;
  plan: string;
  status: "trial" | "activo" | "suspenso";
  activatedAt: string | null;
};

export type Company = {
  id: string;
  name: string;
  nuit: string | null;
  address: string | null;
  logoUrl: string | null;
  defaultCurrency: string;
  workingDaysPerMonth: number;
  workingHoursPerDay: string;
  province: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bankDetails: string | null;
  documentFooter: string | null;
  responsibleName: string | null;
  enabledModules: CompanyModuleKey[];
  brandName: string | null;
  primaryColor: string;
  accentColor: string;
  defaultLanguage: "pt" | "en";
  createdAt: string;
  subscription?: Subscription | null;
};

export type CompanyModuleKey = "dashboard" | "measurements" | "budgets" | "catalog" | "suppliers" | "purchasing" | "schedule" | "site_diary" | "financial" | "quick_calculations";

export type AdminCompanyUser = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  email: string;
  role: "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: "pt" | "en";
  lastLoginAt: string | null;
  createdAt: string;
};

export type CompanyUpdateInput = Partial<{
  name: string;
  nuit: string;
  address: string;
  province: string;
  district: string;
  phone: string;
  email: string;
  website: string;
  bankDetails: string;
  documentFooter: string;
  responsibleName: string;
  defaultCurrency: string;
  workingDaysPerMonth: number;
  workingHoursPerDay: number;
}>;

export const companiesApi = {
  list: () => request<Company[]>("/companies"),
  create: (data: { name: string; adminName: string; adminEmail: string; adminPassword: string; defaultCurrency?: string }) =>
    request<{ company: Company }>("/companies", { method: "POST", body: JSON.stringify(data) }),
  updateSubscription: (companyId: string, data: { status?: "trial" | "activo" | "suspenso"; plan?: string }) =>
    request<Subscription>(`/companies/${companyId}/subscription`, { method: "PUT", body: JSON.stringify(data) }),
  updateAdminSettings: (companyId: string, data: Partial<Pick<Company, "name" | "defaultCurrency" | "enabledModules" | "brandName" | "primaryColor" | "accentColor" | "defaultLanguage">>) =>
    request<Company>(`/admin/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(data) }),
  listAdminUsers: (companyId?: string) => request<AdminCompanyUser[]>(`/admin/users${companyId ? `?companyId=${companyId}` : ""}`),
  createAdminUser: (companyId: string, data: { name: string; email: string; password: string; role: AdminCompanyUser["role"]; preferredLanguage: "pt" | "en" }) =>
    request<AdminCompanyUser>(`/admin/companies/${companyId}/users`, { method: "POST", body: JSON.stringify(data) }),
  updateAdminUser: (userId: string, data: Partial<Pick<AdminCompanyUser, "name" | "role" | "isActive" | "preferredLanguage">>) =>
    request<AdminCompanyUser>(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetAdminUserPassword: (userId: string, password: string) => request<{ ok: true }>(`/admin/users/${userId}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),

  me: () => request<{ company: Company; subscription: Subscription | null }>("/companies/me"),
  updateMe: (data: CompanyUpdateInput) => request<Company>("/companies/me", { method: "PUT", body: JSON.stringify(data) }),
  uploadLogo: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/companies/me/logo", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<Company>;
  },
};
