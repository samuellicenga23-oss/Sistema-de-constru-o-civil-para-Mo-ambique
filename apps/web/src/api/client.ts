import { request, ApiError } from "./http";

export type CurrentUser = {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: "super_admin" | "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";
};

export const api = {
  me: () => request<CurrentUser>("/auth/me"),
  login: (email: string, password: string) =>
    request<CurrentUser>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  listUsers: () =>
    request<Array<{ id: string; name: string; email: string; role: string; createdAt: string }>>("/users"),
};

export { ApiError };
