import type { CurrentUser } from "../api/client";

type Role = CurrentUser["role"];

const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  super_admin: {
    label: "Super Admin",
    description: "Gere todas as empresas, planos e o catálogo global da plataforma.",
  },
  admin_empresa: {
    label: "Administrador da Empresa",
    description: "Pode gerir utilizadores, projectos, catálogos permitidos e as definições da empresa.",
  },
  orcamentista: {
    label: "Orçamentista",
    description: "Pode gerir projectos, orçamentos e usar as composições de custo permitidas.",
  },
  engenheiro_fiscal: {
    label: "Engenheiro/Fiscal",
    description: "Pode consultar projectos e medições, e preencher o diário de obra.",
  },
  visualizador: {
    label: "Visualizador",
    description: "Só pode consultar — sem permissão para criar ou alterar dados.",
  },
};

export function roleLabel(role: Role): string {
  return ROLE_INFO[role].label;
}

// Mostra o perfil actual de forma clara, com uma frase a explicar o que pode fazer — pedido
// explícito do documento da Fase 1 ("componente visual para mostrar claramente o perfil actual").
export default function RoleBadge({ role, showDescription = true }: { role: Role; showDescription?: boolean }) {
  const info = ROLE_INFO[role];
  return (
    <div>
      <span className="badge badge-brand">{info.label}</span>
      {showDescription && <p className="muted mt-1.5">{info.description}</p>}
    </div>
  );
}
