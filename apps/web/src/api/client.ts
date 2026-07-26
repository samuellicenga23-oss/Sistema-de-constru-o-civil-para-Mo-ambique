import { request, ApiError } from "./http";

export type CurrentUser = {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: "super_admin" | "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";
  avatarUrl: string | null;
  lastLoginAt: string | null;
  preferredLanguage: string;
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
  me: () => request<CurrentUser>("/auth/me"),
  login: (email: string, password: string) =>
    request<CurrentUser>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  listUsers: () =>
    request<Array<{ id: string; name: string; email: string; role: string; createdAt: string }>>("/users"),
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
