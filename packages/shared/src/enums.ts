export const USER_ROLES = [
  "super_admin",
  "admin_empresa",
  "orcamentista",
  "engenheiro_fiscal",
  "visualizador",
] as const;

export const COMPANY_MODULE_KEYS = [
  "dashboard",
  "measurements",
  "budgets",
  "catalog",
  "suppliers",
  "purchasing",
  "schedule",
  "site_diary",
  "financial",
  "quick_calculations",
] as const;
export type CompanyModuleKey = (typeof COMPANY_MODULE_KEYS)[number];
export type UserRole = (typeof USER_ROLES)[number];

export const CURRENCIES = ["MZN", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const UNITS = ["m", "m2", "m3", "ml", "kg", "un", "vg", "h"] as const;
export type Unit = (typeof UNITS)[number];

export const LINE_ITEM_KINDS = ["capitulo", "grupo", "item", "nota"] as const;
export type LineItemKind = (typeof LINE_ITEM_KINDS)[number];

export const LINE_ITEM_ORIGINS = ["manual", "planta", "composicao", "estimativa"] as const;
export type LineItemOrigin = (typeof LINE_ITEM_ORIGINS)[number];

export const DOCUMENT_STATUSES = ["rascunho", "submetido", "aprovado"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ["trial", "activo", "suspenso"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// Estrutura de planos comerciais SIGO (7 níveis) — activação/mudança de plano é sempre manual
// pelo super_admin (sem gateway de pagamento; factura-se fora do sistema). `maxUsers`/
// `maxProjects` são limites reais aplicados no backend (ver users.ts/projects.ts), não só texto
// informativo. Preços/limites vêm do documento de recomendações comerciais do utilizador
// (SIGO_Recomendacoes_Planos_Precos_Demonstracoes.txt, secções 36-45) — não são dados de mercado
// verificados externamente, são a proposta de lançamento do próprio utilizador, ajustável a
// qualquer momento no Catálogo... quer dizer, aqui mesmo neste ficheiro.
// `monthlyPriceMzn: null` = "sob proposta" (só o plano Institucional).
export const SUBSCRIPTION_PLANS = [
  {
    key: "free",
    label: "Free",
    maxUsers: 1,
    maxProjects: 1,
    monthlyPriceMzn: 0,
    annualPriceMzn: null,
    priceNote: null,
    features: [
      "1 projecto activo",
      "Mapa de Quantidades e Catálogo básicos",
      "Até 10 composições personalizadas",
      "Calculadoras simples",
      "Exportação com marca de água \"Gerado pelo SIGO Free\"",
    ],
  },
  {
    key: "particular",
    label: "Particular",
    maxUsers: 1,
    maxProjects: 1,
    monthlyPriceMzn: 490,
    annualPriceMzn: null,
    priceNote: "ou 2.490 MT por projecto (acesso 12 meses)",
    features: [
      "Simulador \"Quero Construir\"",
      "Plano da obra e materiais por fase",
      "Controlo de pagamentos e despesas",
      "Cofre digital de documentos",
      "Interface simplificada para proprietários",
    ],
  },
  {
    key: "individual",
    label: "Individual",
    maxUsers: 1,
    maxProjects: 5,
    monthlyPriceMzn: 1490,
    annualPriceMzn: 14900,
    priceNote: null,
    features: [
      "Mapa de Quantidades, Orçamentos e Composições",
      "Cálculos Rápidos e Assistente de Medições",
      "Autos de Medição básicos",
      "Diário de obra",
      "Aplicação móvel",
    ],
  },
  {
    key: "profissional",
    label: "Profissional",
    maxUsers: 5,
    maxProjects: 15,
    monthlyPriceMzn: 5900,
    annualPriceMzn: 59000,
    priceNote: null,
    features: [
      "Tudo do Individual",
      "Gestão de utilizadores e permissões",
      "Portal do cliente",
      "Fornecedores, cotações e ordens de compra",
      "Armazém básico e fluxo de caixa por obra",
      "WhatsApp e funcionamento offline",
    ],
  },
  {
    key: "empresa",
    label: "Empresa",
    maxUsers: 15,
    maxProjects: 50,
    monthlyPriceMzn: 14900,
    annualPriceMzn: 149000,
    priceNote: null,
    features: [
      "Tudo do Profissional",
      "Gestão financeira completa (centro de custos, margens)",
      "Armazém completo e múltiplos armazéns",
      "Trabalhadores e equipamentos",
      "Contratos e aditamentos",
      "Cronograma avançado e Curva S",
    ],
  },
  {
    key: "empresarial",
    label: "Empresarial",
    maxUsers: 40,
    maxProjects: null,
    monthlyPriceMzn: 34900,
    annualPriceMzn: 349000,
    priceNote: null,
    features: [
      "Tudo do Empresa",
      "Projectos activos ilimitados",
      "Multi-filial e multi-armazém",
      "API com limites comerciais",
      "Dashboards executivos e IA",
      "Gestor de conta dedicado",
    ],
  },
  {
    key: "institucional",
    label: "Institucional",
    maxUsers: null,
    maxProjects: null,
    monthlyPriceMzn: null,
    annualPriceMzn: null,
    priceNote: "a partir de 75.000 MT/mês, sob proposta — taxa de implementação a partir de 250.000 MT",
    features: [
      "Tudo do Empresarial",
      "Infra-estrutura e base de dados dedicadas",
      "Single Sign-On e auditoria institucional",
      "Acordo de nível de serviço (SLA)",
      "Formação presencial e migração de dados",
      "Consultoria e suporte dedicado",
    ],
  },
] as const;
export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLANS)[number]["key"];
export const SUBSCRIPTION_PLAN_KEYS = SUBSCRIPTION_PLANS.map((p) => p.key) as SubscriptionPlanKey[];
export function getPlanDefinition(key: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.key === key) ?? null;
}
// Mapeamento dos planos antigos (3 níveis, lançados antes deste documento) para os novos, usado
// uma única vez numa migração de dados — ver db/migratePlansToSigo.ts.
export const LEGACY_PLAN_MIGRATION: Record<string, SubscriptionPlanKey> = {
  starter: "individual",
  standard: "profissional",
  pro: "empresarial",
};

export const PLANT_DISCIPLINES = ["arquitectura", "estrutura"] as const;
export type PlantDiscipline = (typeof PLANT_DISCIPLINES)[number];

export const PLANT_PROCESSING_STATUSES = [
  "pendente",
  "processando",
  "concluido",
  "erro",
] as const;
export type PlantProcessingStatus = (typeof PLANT_PROCESSING_STATUSES)[number];

export const DEFAULT_IVA_RATE = 0.16;
export const DEFAULT_CONTINGENCIAS_RATE = 0.1;

export function calculateVatTotals(subtotal: number, ivaRate = DEFAULT_IVA_RATE) {
  const iva = subtotal * ivaRate;
  return { subtotal, ivaRate, iva, total: subtotal + iva };
}

export function priceExcludingVat(value: number, includesVat: boolean, ivaRate = DEFAULT_IVA_RATE) {
  return includesVat ? value / (1 + ivaRate) : value;
}
