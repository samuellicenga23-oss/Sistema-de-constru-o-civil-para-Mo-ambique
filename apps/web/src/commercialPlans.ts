import {
  SUBSCRIPTION_PLANS,
  calculateVatTotals,
  getPlanDefinition,
  type PublicSubscriptionPlanKey,
} from "@sigo/shared";

export const SIGO_WHATSAPP_NUMBER = "258866384194";
export const SIGO_CONTACT_EMAIL = "licsenga.samuel@mechanical.co.mz";

/** Dados para pagamento manual (sem gateway) — titular: Samuel Rafael Licenga. */
export const PAYMENT_DETAILS = {
  holder: "Samuel Rafael Licenga",
  banks: [
    { name: "Millennium BIM", account: "374947681" },
    { name: "Standard Bank", account: "1058484601005", nib: "000301050848460100523" },
    { name: "EDBANK", account: "00041496100", nib: "004300000004149610061" },
  ],
  mobileMoney: [
    { name: "e-Mola", number: "866384194" },
    { name: "M-Pesa", number: "842003777" },
  ],
} as const;

export type CommercialPlan = {
  slug: PublicSubscriptionPlanKey;
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

/** Landing / checkout — mesma fonte que a API (`packages/shared/src/plans.ts`). Enterprise fica “sob consulta”. */
export const COMMERCIAL_PLANS: CommercialPlan[] = SUBSCRIPTION_PLANS.filter(
  (plan) => plan.key !== "enterprise" && plan.monthlyPriceMzn != null && plan.annualPriceMzn != null,
).map((plan) => {
  const lim = plan.limits;
  const limitsParts = [
    lim.maxUsers == null ? "Utilizadores conforme contrato" : `${lim.maxUsers} utilizador${lim.maxUsers === 1 ? "" : "es"}`,
    lim.maxActiveProjects == null ? "Obras ilimitadas" : `${lim.maxActiveProjects} obras activas`,
    lim.smartImportsPerMonth == null ? "Imports ilimitados" : `${lim.smartImportsPerMonth} imports/mês`,
    lim.plantAnalysesPerMonth == null ? "Plantas ilimitadas" : `${lim.plantAnalysesPerMonth} plantas/mês`,
  ];
  return {
    slug: plan.key,
    name: plan.label,
    monthlyPrice: plan.monthlyPriceMzn!,
    annualPrice: plan.annualPriceMzn!,
    regularAnnualPrice: plan.regularAnnualPriceMzn ?? plan.monthlyPriceMzn! * 12,
    description: plan.description,
    audience: plan.audience,
    limits: limitsParts.join(" · "),
    features: [...plan.features],
    featured: Boolean(plan.featured),
  };
});

export function findCommercialPlan(slug: string | undefined) {
  return COMMERCIAL_PLANS.find((plan) => plan.slug === slug) ?? null;
}

/** Plano interno activado pelo super_admin = slug comercial (já unificado). */
export const COMMERCIAL_TO_INTERNAL_PLAN = {
  individual: "individual",
  profissional: "profissional",
  empresa: "empresa",
  enterprise: "enterprise",
  /** legado landing */
  fundamento: "individual",
} as const;

export function formatMzn(value: number) {
  return `${value.toLocaleString("pt-MZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MZN`;
}

export function formatPlanPriceWithVat(netAmount: number) {
  return formatMzn(calculateVatTotals(netAmount).total);
}

export { getPlanDefinition };
