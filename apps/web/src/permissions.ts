import type { CurrentUser } from "./api/client";

export type Role = CurrentUser["role"];

// Mapa central de permissões de NAVEGAÇÃO (Fase 1, Etapa 5) — só decide que páginas cada
// perfil pode abrir, não que acções pode fazer lá dentro (isso continua a ser controlado
// campo a campo em cada página, e sempre reforçado pelo backend, que é a autoridade final).
// Antes disto, só o item do menu ficava escondido — a rota em si era sempre acessível
// escrevendo o URL directamente.

// super_admin só gere a plataforma — nunca vê dados operacionais de nenhuma empresa.
const SUPER_ADMIN_ALLOWED = new Set(["/", "/perfil", "/admin"]);

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
