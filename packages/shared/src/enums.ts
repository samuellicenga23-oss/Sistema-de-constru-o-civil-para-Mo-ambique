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
  "practice",
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

/** Planos, preços e entitlements: ver `plans.ts` (fonte única). */

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
