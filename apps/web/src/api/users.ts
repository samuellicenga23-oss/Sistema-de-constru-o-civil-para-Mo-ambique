import { request } from "./http";
import type { CompanyUserRole, PermissionDef, PermissionGroup } from "@sigo/shared";

export type { CompanyUserRole };

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: CompanyUserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  hasGoogleLogin: boolean;
  permissions: string[];
  permissionCount: number;
  createdAt: string;
};

export type PermissionCatalogResponse = {
  catalog: PermissionDef[];
  groups: PermissionGroup[];
  roleTemplates: Record<CompanyUserRole, string[]>;
  systemDefaults: Record<CompanyUserRole, readonly string[]>;
};

export const usersApi = {
  list: () => request<CompanyUser[]>("/users"),
  permissionCatalog: () => request<PermissionCatalogResponse>("/users/permission-catalog"),
  saveRolePermissions: (rolePermissions: Partial<Record<CompanyUserRole, string[]>>) =>
    request<{ roleTemplates: Record<CompanyUserRole, string[]> }>("/users/role-permissions", {
      method: "PUT",
      body: JSON.stringify({ rolePermissions }),
    }),
  create: (data: { name: string; email: string; password: string; role: CompanyUserRole }) =>
    request<CompanyUser>("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: string,
    data: { name?: string; role?: CompanyUserRole; isActive?: boolean; permissions?: string[] },
  ) => request<CompanyUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  restorePermissions: (id: string) =>
    request<CompanyUser>(`/users/${id}/restore-permissions`, { method: "POST" }),
  resetPassword: (id: string, password: string) =>
    request<CompanyUser>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  delete: (id: string) => request<{ ok: true }>(`/users/${id}`, { method: "DELETE" }),
};
