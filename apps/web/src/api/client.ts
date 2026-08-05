import { request, ApiError } from "./http";
import type { CompanyModuleKey } from "./companies";

export type CurrentUser = {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: "super_admin" | "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";
  /** Papel real na plataforma quando se actua como empresa (impersonação). */
  platformRole?: "super_admin" | "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador" | null;
  actingCompanyId?: string | null;
  actingCompanyName?: string | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: string;
  enabledModules: CompanyModuleKey[];
  permissions: string[];
  createdAt: string;
};

export type UserSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
};

export const api = {
  me: () => request<CurrentUser>("/auth/me", { timeoutMs: 8_000 }),
  login: (email: string, password: string) =>
    request<CurrentUser>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  updateProfile: (data: { name?: string; preferredLanguage?: string }) =>
    request<CurrentUser>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),
  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/auth/me/avatar", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<{ avatarUrl: string }>;
  },
  deleteAvatar: () => request<{ ok: true }>("/auth/me/avatar", { method: "DELETE" }),
  listSessions: () => request<UserSession[]>("/auth/sessions"),
  deleteSession: (id: string) => request<{ ok: true }>(`/auth/sessions/${id}`, { method: "DELETE" }),
  terminateOtherSessions: () => request<{ ok: true }>("/auth/sessions/terminate-others", { method: "POST" }),
};

export { ApiError };
