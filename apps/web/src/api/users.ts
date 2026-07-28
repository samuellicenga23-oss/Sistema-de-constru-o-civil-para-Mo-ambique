import { request } from "./http";

export type CompanyUserRole = "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: CompanyUserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  hasGoogleLogin: boolean;
  createdAt: string;
};

export const usersApi = {
  list: () => request<CompanyUser[]>("/users"),
  create: (data: { name: string; email: string; password: string; role: CompanyUserRole }) =>
    request<CompanyUser>("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; role?: CompanyUserRole; isActive?: boolean }) =>
    request<CompanyUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetPassword: (id: string, password: string) =>
    request<CompanyUser>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  delete: (id: string) => request<{ ok: true }>(`/users/${id}`, { method: "DELETE" }),
};
