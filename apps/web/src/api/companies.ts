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
  createdAt: string;
  subscription?: Subscription | null;
};

export const companiesApi = {
  list: () => request<Company[]>("/companies"),
  create: (data: { name: string; adminName: string; adminEmail: string; adminPassword: string; defaultCurrency?: string }) =>
    request<{ company: Company }>("/companies", { method: "POST", body: JSON.stringify(data) }),
  updateSubscription: (companyId: string, data: { status?: "trial" | "activo" | "suspenso"; plan?: string }) =>
    request<Subscription>(`/companies/${companyId}/subscription`, { method: "PUT", body: JSON.stringify(data) }),

  me: () => request<{ company: Company; subscription: Subscription | null }>("/companies/me"),
  updateMe: (data: { name?: string; nuit?: string; address?: string }) =>
    request<Company>("/companies/me", { method: "PUT", body: JSON.stringify(data) }),
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
