import { describe, it, expect } from "vitest";
import { canAccessPath, isModuleEnabled, type Role } from "../src/permissions";

function user(role: Role, platformRole: Role = role) {
  return { role, platformRole };
}

describe("canAccessPath", () => {
  it("super_admin só acede ao painel, perfil e administração", () => {
    expect(canAccessPath(user("super_admin"), "/painel")).toBe(true);
    expect(canAccessPath(user("super_admin"), "/perfil")).toBe(true);
    expect(canAccessPath(user("super_admin"), "/admin")).toBe(true);
    expect(canAccessPath(user("super_admin"), "/projectos")).toBe(false);
    expect(canAccessPath(user("super_admin"), "/empresa")).toBe(false);
  });

  it("perfis de empresa nunca acedem a /admin", () => {
    for (const role of ["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"] as const) {
      expect(canAccessPath(user(role), "/admin")).toBe(false);
    }
  });

  it("só admin_empresa acede a /empresa", () => {
    expect(canAccessPath(user("admin_empresa"), "/empresa")).toBe(true);
    expect(canAccessPath(user("orcamentista"), "/empresa")).toBe(false);
    expect(canAccessPath(user("engenheiro_fiscal"), "/empresa")).toBe(false);
    expect(canAccessPath(user("visualizador"), "/empresa")).toBe(false);
  });

  it("todos os perfis de empresa acedem às páginas operacionais comuns", () => {
    for (const role of ["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"] as const) {
      expect(canAccessPath(user(role), "/projectos")).toBe(true);
      expect(canAccessPath(user(role), "/catalogo")).toBe(true);
      expect(canAccessPath(user(role), "/perfil")).toBe(true);
    }
  });
});

describe("isModuleEnabled", () => {
  it("bloqueia páginas de módulos desligados sem afectar perfil e definições", () => {
    const enabled = ["dashboard", "budgets"] as const;
    expect(isModuleEnabled("/painel", [...enabled])).toBe(true);
    expect(isModuleEnabled("/orcamentos", [...enabled])).toBe(true);
    expect(isModuleEnabled("/fornecedores", [...enabled])).toBe(false);
    expect(isModuleEnabled("/projectos/abc/compras", [...enabled])).toBe(false);
    expect(isModuleEnabled("/perfil", [...enabled])).toBe(true);
  });
});
