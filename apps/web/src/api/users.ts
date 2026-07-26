import { request } from "./http";

export type CompanyUserRole = "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: CompanyUserRole;
  createdAt: string;
};

export const usersApi = {
  list: () => request<CompanyUser[]>("/users"),
  create: (data: { name: string; email: string; password: string; role: CompanyUserRole }) =>
    request<{ id: string; name: string; email: string; role: CompanyUserRole }>("/users", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/users/${id}`, { method: "DELETE" }),
};
