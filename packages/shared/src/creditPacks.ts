/**
 * Packs de créditos extra (importações inteligentes e análises de plantas).
 * Preços sem IVA — a UI aplica 16% na apresentação comercial.
 *
 * Lógica de preço (vs plano Individual ~4 900 MZN com 5+5 incluídos):
 * - Overage pontual mais barato que saltar de plano, mais caro que o “incluído”.
 * - Packs maiores com desconto unitário (~15–20%).
 * - Plantas ligeiramente acima de importações (custo de processamento).
 * - Limites estruturais (utilizadores / obras / composições) → upgrade de plano, não créditos.
 */

export type CreditKind = "smart_import" | "plant_analysis";

export type CreditPack = {
  id: string;
  label: string;
  description: string;
  /** Créditos de importação inteligente. */
  smartImports: number;
  /** Créditos de análise de plantas. */
  plantAnalyses: number;
  /** Preço líquido MZN (sem IVA). */
  priceMzn: number;
  featured?: boolean;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "imports_10",
    label: "Importações · 10",
    description: "10 importações inteligentes extra — válidas até serem usadas.",
    smartImports: 10,
    plantAnalyses: 0,
    priceMzn: 1900,
  },
  {
    id: "imports_30",
    label: "Importações · 30",
    description: "30 importações inteligentes com melhor preço unitário.",
    smartImports: 30,
    plantAnalyses: 0,
    priceMzn: 4900,
  },
  {
    id: "plants_10",
    label: "Plantas · 10",
    description: "10 análises de plantas extra — válidas até serem usadas.",
    smartImports: 0,
    plantAnalyses: 10,
    priceMzn: 2400,
  },
  {
    id: "plants_30",
    label: "Plantas · 30",
    description: "30 análises de plantas com melhor preço unitário.",
    smartImports: 0,
    plantAnalyses: 30,
    priceMzn: 6200,
  },
  {
    id: "misto_15",
    label: "Misto · 15+15",
    description: "15 importações e 15 plantas — ideal quando o mês aperta nos dois.",
    smartImports: 15,
    plantAnalyses: 15,
    priceMzn: 5900,
    featured: true,
  },
];

export function getCreditPack(id: string | null | undefined): CreditPack | null {
  if (!id) return null;
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Códigos de limite que apontam para packs de créditos (vs upgrade de plano). */
export const METERED_LIMIT_CODES = ["PLAN_SMART_IMPORT_LIMIT", "PLAN_PLANT_LIMIT"] as const;
export type MeteredLimitCode = (typeof METERED_LIMIT_CODES)[number];

export function isMeteredLimitCode(code: string | undefined): code is MeteredLimitCode {
  return !!code && (METERED_LIMIT_CODES as readonly string[]).includes(code);
}

/** Códigos que pedem upgrade de plano (capacidade estrutural). */
export const PLAN_UPGRADE_CODES = [
  "PLAN_PROJECT_LIMIT",
  "PLAN_USER_LIMIT",
  "PLAN_COMPOSITION_LIMIT",
  "PLAN_TEAM_REQUIRED",
  "PLAN_BRANDING_REQUIRED",
  "SUBSCRIPTION_EXPIRED",
  "SUBSCRIPTION_SUSPENDED",
] as const;

export function creditsActionPath(code: string | undefined): string {
  if (code === "PLAN_SMART_IMPORT_LIMIT") return "/creditos?foco=importacoes";
  if (code === "PLAN_PLANT_LIMIT") return "/creditos?foco=plantas";
  if (code === "SUBSCRIPTION_EXPIRED" || code === "SUBSCRIPTION_SUSPENDED") return "/creditos?foco=plano";
  if (
    code === "PLAN_PROJECT_LIMIT" ||
    code === "PLAN_USER_LIMIT" ||
    code === "PLAN_COMPOSITION_LIMIT" ||
    code === "PLAN_TEAM_REQUIRED" ||
    code === "PLAN_BRANDING_REQUIRED"
  ) {
    return "/creditos?foco=plano";
  }
  return "/creditos";
}
