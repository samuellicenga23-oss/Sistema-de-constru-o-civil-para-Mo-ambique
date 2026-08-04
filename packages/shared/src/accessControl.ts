import type { UserRole } from "./enums.js";

/** Papéis geridos pela empresa (sem super_admin da plataforma). */
export const COMPANY_USER_ROLES = [
  "admin_empresa",
  "orcamentista",
  "engenheiro_fiscal",
  "visualizador",
] as const;
export type CompanyUserRole = (typeof COMPANY_USER_ROLES)[number];

export const PERMISSION_GROUPS = [
  "Obras",
  "Medições",
  "Orçamentos",
  "Catálogo",
  "Compras",
  "Cronograma",
  "Diário",
  "Financeiro",
  "Equipa",
  "Relatórios",
  "Plataforma",
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export type PermissionDef = {
  id: string;
  label: string;
  group: PermissionGroup;
};

/** Catálogo estável — nunca depender só do label. */
export const PERMISSION_CATALOG: PermissionDef[] = [
  { id: "obras.ver", label: "Ver obras / projectos", group: "Obras" },
  { id: "obras.criar", label: "Criar obras", group: "Obras" },
  { id: "obras.editar", label: "Editar obras", group: "Obras" },
  { id: "obras.fechar", label: "Fechar / arquivar obras", group: "Obras" },

  { id: "medicoes.ver", label: "Ver medições", group: "Medições" },
  { id: "medicoes.editar", label: "Editar medições", group: "Medições" },
  { id: "medicoes.enviar_orcamento", label: "Enviar medição para orçamento", group: "Medições" },

  { id: "orcamentos.ver", label: "Ver orçamentos", group: "Orçamentos" },
  { id: "orcamentos.editar", label: "Editar orçamentos", group: "Orçamentos" },
  { id: "orcamentos.submeter", label: "Submeter orçamentos", group: "Orçamentos" },
  { id: "orcamentos.aprovar", label: "Aprovar orçamentos", group: "Orçamentos" },

  { id: "catalogo.ver", label: "Ver catálogo", group: "Catálogo" },
  { id: "catalogo.editar", label: "Editar catálogo e composições", group: "Catálogo" },

  { id: "materiais.ver", label: "Ver materiais e stock", group: "Compras" },
  { id: "materiais.requisitar", label: "Requisitar / criar pedidos", group: "Compras" },
  { id: "materiais.aprovar", label: "Aprovar ordens de compra", group: "Compras" },
  { id: "fornecedores.gerir", label: "Gerir fornecedores e cotações", group: "Compras" },

  { id: "cronograma.ver", label: "Ver cronograma", group: "Cronograma" },
  { id: "cronograma.editar", label: "Editar cronograma", group: "Cronograma" },

  { id: "diario.registar", label: "Registar diário de obra", group: "Diário" },
  { id: "diario.aprovar", label: "Aprovar diário / autos", group: "Diário" },
  { id: "autos.ver", label: "Ver autos de medição", group: "Diário" },
  { id: "autos.editar", label: "Editar autos de medição", group: "Diário" },

  { id: "financeiro.ver", label: "Ver financeiro", group: "Financeiro" },
  { id: "financeiro.lancar", label: "Lançar movimentos financeiros", group: "Financeiro" },

  { id: "escritorio.ver", label: "Ver escritório (cotações e honorários)", group: "Financeiro" },
  { id: "escritorio.gerir", label: "Gerir cotações, facturas e recibos do escritório", group: "Financeiro" },

  { id: "equipa.gerir", label: "Gerir utilizadores e acessos", group: "Equipa" },
  { id: "equipa.ver", label: "Ver equipa", group: "Equipa" },

  { id: "relatorios.exportar", label: "Exportar PDF / Excel", group: "Relatórios" },

  { id: "plataforma.configuracoes", label: "Definições da empresa", group: "Plataforma" },
  { id: "calculos.usar", label: "Usar cálculos rápidos", group: "Plataforma" },
];

export const PERMISSION_IDS = PERMISSION_CATALOG.map((p) => p.id);
export type PermissionId = (typeof PERMISSION_IDS)[number];

const ALL = PERMISSION_IDS;

const READ_OPS = [
  "obras.ver",
  "medicoes.ver",
  "orcamentos.ver",
  "catalogo.ver",
  "materiais.ver",
  "cronograma.ver",
  "autos.ver",
  "financeiro.ver",
  "escritorio.ver",
  "equipa.ver",
  "relatorios.exportar",
  "calculos.usar",
] as const;

/** Templates de sistema — usados quando a empresa ainda não personalizou. */
export const SYSTEM_ROLE_PERMISSIONS: Record<CompanyUserRole, readonly string[]> = {
  admin_empresa: ALL,
  orcamentista: [
    "obras.ver",
    "obras.criar",
    "obras.editar",
    "medicoes.ver",
    "medicoes.editar",
    "medicoes.enviar_orcamento",
    "orcamentos.ver",
    "orcamentos.editar",
    "orcamentos.submeter",
    "catalogo.ver",
    "catalogo.editar",
    "materiais.ver",
    "materiais.requisitar",
    "materiais.aprovar",
    "fornecedores.gerir",
    "cronograma.ver",
    "cronograma.editar",
    "diario.registar",
    "autos.ver",
    "financeiro.ver",
    "escritorio.ver",
    "escritorio.gerir",
    "equipa.ver",
    "relatorios.exportar",
    "calculos.usar",
  ],
  engenheiro_fiscal: [
    "obras.ver",
    "medicoes.ver",
    "orcamentos.ver",
    "catalogo.ver",
    "materiais.ver",
    "materiais.requisitar",
    "cronograma.ver",
    "cronograma.editar",
    "diario.registar",
    "diario.aprovar",
    "autos.ver",
    "autos.editar",
    "financeiro.ver",
    "escritorio.ver",
    "equipa.ver",
    "relatorios.exportar",
    "calculos.usar",
  ],
  visualizador: [...READ_OPS],
};

export type RolePermissionsMap = Partial<Record<CompanyUserRole, string[]>>;

export function isCompanyUserRole(role: string): role is CompanyUserRole {
  return (COMPANY_USER_ROLES as readonly string[]).includes(role);
}

export function resolveRoleTemplate(
  role: CompanyUserRole,
  companyMap?: RolePermissionsMap | null,
): string[] {
  const custom = companyMap?.[role];
  if (custom && Array.isArray(custom)) return [...new Set(custom)];
  return [...SYSTEM_ROLE_PERMISSIONS[role]];
}

export function hasPermission(permissions: readonly string[] | null | undefined, id: string): boolean {
  return Boolean(permissions?.includes(id));
}

export function permissionsByGroup(permissions = PERMISSION_CATALOG) {
  const map = new Map<PermissionGroup, PermissionDef[]>();
  for (const group of PERMISSION_GROUPS) map.set(group, []);
  for (const perm of permissions) {
    map.get(perm.group)?.push(perm);
  }
  return map;
}

export function roleLabel(role: UserRole | CompanyUserRole): string {
  const labels: Record<string, string> = {
    super_admin: "Super Admin",
    admin_empresa: "Administrador",
    orcamentista: "Orçamentista",
    engenheiro_fiscal: "Engenheiro / Fiscal",
    visualizador: "Visualizador",
  };
  return labels[role] ?? role;
}
