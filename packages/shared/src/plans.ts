import { COMPANY_MODULE_KEYS, type CompanyModuleKey } from "./enums.js";

/**
 * Catálogo único de planos SIGO.
 * Preços mensais/anuais são sem IVA (a landing aplica 16% na apresentação).
 * Os valores “com IVA” da proposta comercial: Individual 5.684 / 57.976,80;
 * Profissional 14.964 / 152.632,80; Empresa 34.684 / 353.776,80.
 */

export const PUBLIC_SUBSCRIPTION_PLAN_KEYS = ["individual", "profissional", "empresa", "enterprise"] as const;
export type PublicSubscriptionPlanKey = (typeof PUBLIC_SUBSCRIPTION_PLAN_KEYS)[number];

/** Inclui chaves legadas ainda presentes na BD. */
export const SUBSCRIPTION_PLAN_KEYS = [
  "individual",
  "profissional",
  "empresa",
  "enterprise",
  "free",
  "particular",
  "empresarial",
  "institucional",
] as const;
export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLAN_KEYS)[number];

export type PlanLimits = {
  maxUsers: number | null;
  maxActiveProjects: number | null;
  customCompositions: number | null;
  smartImportsPerMonth: number | null;
  plantAnalysesPerMonth: number | null;
};

export type PlanCapabilities = {
  teamManagement: boolean;
  customPermissions: boolean;
  permissionTemplates: boolean;
  companyBranding: boolean;
  prioritySupport: boolean;
  assistedMigration: boolean;
  training: "none" | "initial" | "team";
  /** Acesso ao marketplace SIGO Fornecedores (cotações e preços por zona no portal).
   * Abaixo do Profissional, a empresa só tem os preços de referência «SIGO Preços» (que continua
   * livre para editar pessoalmente). */
  supplierMarketplace: boolean;
};

export type PlanDefinition = {
  key: PublicSubscriptionPlanKey;
  label: string;
  audience: string;
  description: string;
  monthlyPriceMzn: number | null;
  annualPriceMzn: number | null;
  /** Preço anual “cheio” (12× mensal) para mostrar poupança — sem IVA. */
  regularAnnualPriceMzn: number | null;
  priceNote: string | null;
  featured?: boolean;
  limits: PlanLimits;
  modules: Record<CompanyModuleKey, boolean>;
  capabilities: PlanCapabilities;
  /** Bullets de marketing derivados dos entitlements. */
  features: string[];
};

const ALL_MODULES_ON = Object.fromEntries(COMPANY_MODULE_KEYS.map((k) => [k, true])) as Record<
  CompanyModuleKey,
  boolean
>;

export const PLAN_CATALOG: Record<PublicSubscriptionPlanKey, PlanDefinition> = {
  individual: {
    key: "individual",
    label: "Individual",
    audience: "Engenheiro, orçamentista, fiscal ou pequeno empreiteiro",
    description: "SIGO completo para uma pessoa e poucas obras.",
    monthlyPriceMzn: 4900,
    annualPriceMzn: 49980,
    regularAnnualPriceMzn: 58800,
    priceNote: null,
    limits: {
      maxUsers: 1,
      maxActiveProjects: 3,
      customCompositions: 30,
      smartImportsPerMonth: 5,
      plantAnalysesPerMonth: 5,
    },
    modules: { ...ALL_MODULES_ON },
    capabilities: {
      teamManagement: false,
      customPermissions: false,
      permissionTemplates: false,
      companyBranding: false,
      prioritySupport: false,
      assistedMigration: false,
      training: "none",
      supplierMarketplace: false,
    },
    features: [
      "Fluxo completo da obra (medições, orçamentos, cronograma, compras, diário, financeiro)",
      "1 utilizador · 3 obras activas",
      "Até 30 composições próprias",
      "5 importações inteligentes / mês",
      "5 análises de plantas / mês",
      "Preços de referência SIGO Preços (editáveis) — sem marketplace de fornecedores",
    ],
  },
  profissional: {
    key: "profissional",
    label: "Profissional",
    audience: "Pequena/média construtora e equipa técnica",
    description: "SIGO completo para uma equipa — colaboração e branding.",
    monthlyPriceMzn: 12900,
    annualPriceMzn: 131580,
    regularAnnualPriceMzn: 154800,
    priceNote: null,
    featured: true,
    limits: {
      maxUsers: 5,
      maxActiveProjects: 15,
      customCompositions: null,
      smartImportsPerMonth: 30,
      plantAnalysesPerMonth: 30,
    },
    modules: { ...ALL_MODULES_ON },
    capabilities: {
      teamManagement: true,
      customPermissions: true,
      permissionTemplates: false,
      companyBranding: true,
      prioritySupport: false,
      assistedMigration: true,
      training: "initial",
      supplierMarketplace: true,
    },
    features: [
      "Tudo do Individual",
      "SIGO Fornecedores: preços reais por zona, contacto directo e PDF do pedido (melhor preço → mais caro)",
      "O SIGO identifica quem tem o material na região da obra e ordena pelo melhor custo",
      "5 utilizadores · 15 obras activas",
      "Composições próprias ilimitadas",
      "30 importações e 30 plantas / mês",
      "Equipa, roles e logótipo nos documentos",
    ],
  },
  empresa: {
    key: "empresa",
    label: "Empresa",
    audience: "Construtora estruturada com várias obras e equipas",
    description: "Escala, governação e suporte prioritário.",
    monthlyPriceMzn: 29900,
    annualPriceMzn: 304980,
    regularAnnualPriceMzn: 358800,
    priceNote: null,
    limits: {
      maxUsers: 15,
      maxActiveProjects: 50,
      customCompositions: null,
      smartImportsPerMonth: 100,
      plantAnalysesPerMonth: 100,
    },
    modules: { ...ALL_MODULES_ON },
    capabilities: {
      teamManagement: true,
      customPermissions: true,
      permissionTemplates: true,
      companyBranding: true,
      prioritySupport: true,
      assistedMigration: true,
      training: "team",
      supplierMarketplace: true,
    },
    features: [
      "Tudo do Profissional (incl. SIGO Fornecedores e PDF de pedidos por preço/zona)",
      "15 utilizadores · 50 obras activas",
      "100 importações e 100 plantas / mês",
      "Templates de permissões e governação",
      "Migração, formação de equipa e suporte prioritário",
    ],
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    audience: "Grandes organizações e requisitos especiais",
    description: "Condições contratuais — escala, SLA e acompanhamento dedicado.",
    monthlyPriceMzn: null,
    annualPriceMzn: null,
    regularAnnualPriceMzn: null,
    priceNote: "sob consulta",
    limits: {
      maxUsers: null,
      maxActiveProjects: null,
      customCompositions: null,
      smartImportsPerMonth: null,
      plantAnalysesPerMonth: null,
    },
    modules: { ...ALL_MODULES_ON },
    capabilities: {
      teamManagement: true,
      customPermissions: true,
      permissionTemplates: true,
      companyBranding: true,
      prioritySupport: true,
      assistedMigration: true,
      training: "team",
      supplierMarketplace: true,
    },
    features: [
      "Tudo do Empresa",
      "Utilizadores e obras conforme contrato",
      "SLA e suporte dedicado",
      "Migração massiva e formação",
      "Integrações e requisitos especiais",
    ],
  },
};

/** Trial: demonstra o produto sem substituir uma subscrição paga. */
export const TRIAL_ENTITLEMENTS: PlanLimits & PlanCapabilities & { modules: Record<CompanyModuleKey, boolean> } = {
  maxUsers: 1,
  maxActiveProjects: 2,
  customCompositions: 30,
  smartImportsPerMonth: 3,
  plantAnalysesPerMonth: 2,
  teamManagement: false,
  customPermissions: false,
  permissionTemplates: false,
  companyBranding: false,
  prioritySupport: false,
  assistedMigration: false,
  training: "none",
  supplierMarketplace: false,
  modules: { ...ALL_MODULES_ON },
};

export const LEGACY_PLAN_MIGRATION: Record<string, PublicSubscriptionPlanKey> = {
  free: "individual",
  particular: "individual",
  starter: "individual",
  standard: "profissional",
  pro: "enterprise",
  empresarial: "enterprise",
  institucional: "enterprise",
  fundamento: "individual",
};

export function normalizePlanKey(key: string | null | undefined): PublicSubscriptionPlanKey {
  if (!key) return "individual";
  if ((PUBLIC_SUBSCRIPTION_PLAN_KEYS as readonly string[]).includes(key)) {
    return key as PublicSubscriptionPlanKey;
  }
  return LEGACY_PLAN_MIGRATION[key] ?? "individual";
}

/** Compat: maxUsers/maxProjects no topo (código legado). */
export type CompatiblePlanView = PlanDefinition & {
  maxUsers: number | null;
  maxProjects: number | null;
};

export function getPlanDefinition(key: string | null | undefined): CompatiblePlanView {
  const plan = PLAN_CATALOG[normalizePlanKey(key)];
  return {
    ...plan,
    maxUsers: plan.limits.maxUsers,
    maxProjects: plan.limits.maxActiveProjects,
  };
}

/** Lista pública ordenada (landing / SuperAdmin). Enterprise no fim. */
export const SUBSCRIPTION_PLANS: CompatiblePlanView[] = PUBLIC_SUBSCRIPTION_PLAN_KEYS.map((k) => getPlanDefinition(k));

export type ResolvedEntitlements = PlanLimits &
  PlanCapabilities & {
    planKey: PublicSubscriptionPlanKey;
    planLabel: string;
    modules: Record<CompanyModuleKey, boolean>;
    /** true quando expiresAt já passou (trial ou ciclo pago). */
    expired: boolean;
    status: string;
    expiresAt: string | null;
    isTrial: boolean;
  };

export function resolveEntitlements(input: {
  plan: string | null | undefined;
  status: string | null | undefined;
  expiresAt?: Date | string | null;
  now?: Date;
}): ResolvedEntitlements {
  const now = input.now ?? new Date();
  const plan = getPlanDefinition(input.plan);
  const status = input.status ?? "trial";
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const expired =
    status !== "suspenso" && expiresAt != null && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime();
  const isTrial = status === "trial";

  const baseLimits = isTrial
    ? {
        maxUsers: TRIAL_ENTITLEMENTS.maxUsers,
        maxActiveProjects: TRIAL_ENTITLEMENTS.maxActiveProjects,
        customCompositions: TRIAL_ENTITLEMENTS.customCompositions,
        smartImportsPerMonth: TRIAL_ENTITLEMENTS.smartImportsPerMonth,
        plantAnalysesPerMonth: TRIAL_ENTITLEMENTS.plantAnalysesPerMonth,
      }
    : { ...plan.limits };

  const baseCaps = isTrial
    ? {
        teamManagement: TRIAL_ENTITLEMENTS.teamManagement,
        customPermissions: TRIAL_ENTITLEMENTS.customPermissions,
        permissionTemplates: TRIAL_ENTITLEMENTS.permissionTemplates,
        companyBranding: TRIAL_ENTITLEMENTS.companyBranding,
        prioritySupport: TRIAL_ENTITLEMENTS.prioritySupport,
        assistedMigration: TRIAL_ENTITLEMENTS.assistedMigration,
        training: TRIAL_ENTITLEMENTS.training,
        supplierMarketplace: TRIAL_ENTITLEMENTS.supplierMarketplace,
      }
    : { ...plan.capabilities };

  return {
    planKey: plan.key,
    planLabel: isTrial ? `${plan.label} (trial)` : plan.label,
    status,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired,
    isTrial,
    modules: isTrial ? { ...TRIAL_ENTITLEMENTS.modules } : { ...plan.modules },
    ...baseLimits,
    ...baseCaps,
  };
}

export function modulesAllowedByPlan(planKey: string | null | undefined): CompanyModuleKey[] {
  const plan = getPlanDefinition(planKey);
  return COMPANY_MODULE_KEYS.filter((k) => plan.modules[k]);
}

/** Empresa só pode restringir módulos; nunca expandir além do plano. */
export function clampModulesToPlan(
  requested: CompanyModuleKey[] | null | undefined,
  planKey: string | null | undefined,
): CompanyModuleKey[] {
  const allowed = new Set(modulesAllowedByPlan(planKey));
  const list = requested?.length ? requested : [...allowed];
  const clamped = list.filter((m) => allowed.has(m));
  return clamped.length ? clamped : [...allowed];
}

export function monthUsageKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
