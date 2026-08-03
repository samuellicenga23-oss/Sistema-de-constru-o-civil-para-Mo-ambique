export const SIGO_WHATSAPP_NUMBER = "258866384194";
export const SIGO_CONTACT_EMAIL = "licsenga.samuel@mechanical.co.mz";

export type CommercialPlan = {
  slug: "fundamento" | "profissional" | "empresa";
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  regularAnnualPrice: number;
  description: string;
  audience: string;
  limits: string;
  features: string[];
  featured?: boolean;
};

export const COMMERCIAL_PLANS: CommercialPlan[] = [
  {
    slug: "fundamento",
    name: "Fundamento",
    monthlyPrice: 4_900,
    annualPrice: 49_980,
    regularAnnualPrice: 58_800,
    description: "Organize custos, documentos e os primeiros projectos num único lugar.",
    audience: "Pequenas empresas e equipas em digitalização",
    limits: "3 obras activas · 5 utilizadores",
    features: ["Orçamentos e composições", "Preços por fornecedor e zona", "Documentos e relatórios PDF", "Cálculos rápidos com custos"],
  },
  {
    slug: "profissional",
    name: "Profissional",
    monthlyPrice: 12_900,
    annualPrice: 131_580,
    regularAnnualPrice: 154_800,
    description: "Ligue planeamento, compras, estaleiro, medição e controlo financeiro.",
    audience: "Construtoras com várias frentes de trabalho",
    limits: "15 obras activas · 20 utilizadores",
    features: ["Tudo do Fundamento", "Cronograma Gantt e subactividades", "Diário e Autos de Medição", "Compras, stock e financeiro", "Acompanhamento de implementação"],
    featured: true,
  },
  {
    slug: "empresa",
    name: "Empresa",
    monthlyPrice: 29_900,
    annualPrice: 304_980,
    regularAnnualPrice: 358_800,
    description: "Governação, capacidade e acompanhamento para operações com várias equipas.",
    audience: "Empresas com operação consolidada",
    limits: "50 obras activas · utilizadores ilimitados",
    features: ["Tudo do Profissional", "Perfis e acessos avançados", "Migração inicial de dados", "Formação da equipa", "Suporte prioritário"],
  },
];

export function findCommercialPlan(slug: string | undefined) {
  return COMMERCIAL_PLANS.find((plan) => plan.slug === slug) ?? null;
}

/** Plano interno SIGO activado pelo super_admin quando o cliente escolhe um plano comercial. */
export const COMMERCIAL_TO_INTERNAL_PLAN = {
  fundamento: "individual",
  profissional: "profissional",
  empresa: "empresa",
} as const;

export function formatMzn(value: number) {
  return `${value.toLocaleString("pt-MZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MZN`;
}
