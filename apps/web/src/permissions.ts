import type { CurrentUser } from "./api/client";
import type { CompanyModuleKey } from "./api/companies";

export type Role = CurrentUser["role"];

// Mapa central de permissões de NAVEGAÇÃO — só decide que páginas cada
// perfil pode abrir, não que acções pode fazer lá dentro (isso continua a ser controlado
// campo a campo em cada página, e sempre reforçado pelo backend, que é a autoridade final).

const SUPER_ADMIN_ALLOWED = new Set(["/painel", "/perfil", "/admin"]);
const ADMIN_EMPRESA_ONLY = new Set(["/empresa"]);

const SITE_MODULES: CompanyModuleKey[] = ["site_diary", "schedule", "purchasing", "financial"];

export function canAccessPath(role: Role, pathname: string): boolean {
  if (role === "super_admin") return SUPER_ADMIN_ALLOWED.has(pathname);
  if (ADMIN_EMPRESA_ONLY.has(pathname)) return role === "admin_empresa";
  if (pathname === "/admin") return false;
  return true;
}

const PATH_MODULES: Array<{ match: (path: string) => boolean; module: CompanyModuleKey }> = [
  { match: (path) => path === "/painel", module: "dashboard" },
  { match: (path) => path === "/medicoes" || path.startsWith("/plantas/"), module: "measurements" },
  { match: (path) => path === "/orcamentos" || path.startsWith("/documentos/"), module: "budgets" },
  { match: (path) => path.startsWith("/catalogo"), module: "catalog" },
  { match: (path) => path === "/fornecedores", module: "suppliers" },
  { match: (path) => path.endsWith("/compras"), module: "purchasing" },
  { match: (path) => path.endsWith("/cronograma"), module: "schedule" },
  { match: (path) => path.endsWith("/diario"), module: "site_diary" },
  { match: (path) => path.endsWith("/financeiro"), module: "financial" },
  { match: (path) => path === "/calculos-rapidos", module: "quick_calculations" },
  { match: (path) => path === "/escritorio" || path.startsWith("/escritorio/"), module: "practice" },
];

export function isSiteManagementModuleEnabled(enabledModules: CompanyModuleKey[]): boolean {
  return SITE_MODULES.some((module) => enabledModules.includes(module));
}

export function isModuleEnabled(pathname: string, enabledModules: CompanyModuleKey[]): boolean {
  if (pathname === "/gestao" || pathname.startsWith("/gestao/")) {
    return isSiteManagementModuleEnabled(enabledModules);
  }
  // Autos fazem parte do fluxo de obra (medição/orçamento); financeiro é a emissão da factura.
  if (pathname.startsWith("/autos/")) {
    return (
      enabledModules.includes("measurements") ||
      enabledModules.includes("budgets") ||
      enabledModules.includes("financial")
    );
  }
  if (pathname.startsWith("/projectos/")) {
    return (
      enabledModules.includes("measurements") ||
      enabledModules.includes("budgets") ||
      isSiteManagementModuleEnabled(enabledModules)
    );
  }
  const required = PATH_MODULES.find((entry) => entry.match(pathname))?.module;
  return !required || enabledModules.includes(required);
}

/** Verifica uma permissão estável do catálogo SIGO (ex.: `equipa.gerir`). */
export function can(user: Pick<CurrentUser, "role" | "permissions"> | null | undefined, permissionId: string): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  return Boolean(user.permissions?.includes(permissionId));
}

export function canAny(
  user: Pick<CurrentUser, "role" | "permissions"> | null | undefined,
  permissionIds: string[],
): boolean {
  return permissionIds.some((id) => can(user, id));
}

export const GESTAO_PERMISSIONS = [
  "diario.registar",
  "diario.aprovar",
  "cronograma.ver",
  "cronograma.editar",
  "materiais.ver",
  "materiais.requisitar",
  "materiais.aprovar",
  "financeiro.ver",
  "financeiro.lancar",
] as const;

export function canSeeGestao(user: Pick<CurrentUser, "role" | "permissions"> | null | undefined): boolean {
  return canAny(user, [...GESTAO_PERMISSIONS]);
}

export function canSeeEscritorio(user: Pick<CurrentUser, "role" | "permissions"> | null | undefined): boolean {
  return can(user, "escritorio.ver") || can(user, "escritorio.gerir");
}
