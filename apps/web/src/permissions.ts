import type { CurrentUser } from "./api/client";
import type { CompanyModuleKey } from "./api/companies";

export type Role = CurrentUser["role"];

// Mapa central de permissões de NAVEGAÇÃO (Fase 1, Etapa 5) — só decide que páginas cada
// perfil pode abrir, não que acções pode fazer lá dentro (isso continua a ser controlado
// campo a campo em cada página, e sempre reforçado pelo backend, que é a autoridade final).
// Antes disto, só o item do menu ficava escondido — a rota em si era sempre acessível
// escrevendo o URL directamente.

// super_admin só gere a plataforma — nunca vê dados operacionais de nenhuma empresa.
const SUPER_ADMIN_ALLOWED = new Set(["/painel", "/perfil", "/admin"]);

// Só o admin_empresa gere as definições e a equipa da própria empresa.
const ADMIN_EMPRESA_ONLY = new Set(["/empresa"]);

export function canAccessPath(role: Role, pathname: string): boolean {
  if (role === "super_admin") return SUPER_ADMIN_ALLOWED.has(pathname);
  if (ADMIN_EMPRESA_ONLY.has(pathname)) return role === "admin_empresa";
  // "/admin" (painel da plataforma) nunca é acessível a perfis de empresa.
  if (pathname === "/admin") return false;
  // Restantes páginas operacionais (projectos, catálogo, fornecedores, cálculos, documentos,
  // autos, plantas): todos os perfis de empresa podem ABRIR — o que cada perfil consegue
  // EDITAR lá dentro já é decidido pelo backend em cada rota (`requireRole`), não aqui.
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
  { match: (path) => path.endsWith("/financeiro") || path.startsWith("/autos/"), module: "financial" },
  { match: (path) => path === "/calculos-rapidos", module: "quick_calculations" },
];

export function isModuleEnabled(pathname: string, enabledModules: CompanyModuleKey[]): boolean {
  const required = PATH_MODULES.find((entry) => entry.match(pathname))?.module;
  return !required || enabledModules.includes(required);
}
