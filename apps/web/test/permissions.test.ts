import { describe, it, expect } from "vitest";
import { canAccessPath } from "../src/permissions";

describe("canAccessPath", () => {
  it("super_admin só acede ao painel, perfil e administração", () => {
    expect(canAccessPath("super_admin", "/painel")).toBe(true);
    expect(canAccessPath("super_admin", "/perfil")).toBe(true);
    expect(canAccessPath("super_admin", "/admin")).toBe(true);
    expect(canAccessPath("super_admin", "/projectos")).toBe(false);
    expect(canAccessPath("super_admin", "/empresa")).toBe(false);
  });

  it("perfis de empresa nunca acedem a /admin", () => {
    for (const role of ["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"] as const) {
      expect(canAccessPath(role, "/admin")).toBe(false);
    }
  });

  it("só admin_empresa acede a /empresa", () => {
    expect(canAccessPath("admin_empresa", "/empresa")).toBe(true);
    expect(canAccessPath("orcamentista", "/empresa")).toBe(false);
    expect(canAccessPath("engenheiro_fiscal", "/empresa")).toBe(false);
    expect(canAccessPath("visualizador", "/empresa")).toBe(false);
  });

  it("todos os perfis de empresa acedem às páginas operacionais comuns", () => {
    for (const role of ["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"] as const) {
      expect(canAccessPath(role, "/projectos")).toBe(true);
      expect(canAccessPath(role, "/catalogo")).toBe(true);
      expect(canAccessPath(role, "/perfil")).toBe(true);
    }
  });
});
