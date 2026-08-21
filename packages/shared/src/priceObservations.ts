import { calendarDaysBetween, maputoTodayIso } from "./countryProfile.js";

export const EFFECTIVE_PRICE_POLICIES = ["manual", "last_confirmed", "median_n"] as const;
export type EffectivePricePolicy = (typeof EFFECTIVE_PRICE_POLICIES)[number];

export const PRICE_OBSERVATION_RESOURCE_TYPES = ["material", "labour", "equipment"] as const;
export type PriceObservationResourceType = (typeof PRICE_OBSERVATION_RESOURCE_TYPES)[number];

export const PRICE_OBSERVATION_CONFIDENCES = ["confirmed", "estimated", "unverified"] as const;
export type PriceObservationConfidence = (typeof PRICE_OBSERVATION_CONFIDENCES)[number];

export type PriceObservationLike = {
  unitCost: number;
  observedAt: string | Date;
  confidence: PriceObservationConfidence;
};

export type EffectivePriceResult = {
  policy: EffectivePricePolicy;
  unitCost: number;
  observationCount: number;
  sourceObservationIds: string[];
  observedAt: string | null;
  source: string | null;
};

export type PriceFreshnessBadge = "confirmado" | "estimado" | "desactualizado";

export const DEFAULT_EFFECTIVE_PRICE_POLICY: EffectivePricePolicy = "last_confirmed";
export const DEFAULT_EFFECTIVE_PRICE_MEDIAN_N = 5;
export const PRICE_OBSERVATION_STALE_DAYS = 180;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function observationDateIso(observedAt: string | Date): string {
  if (observedAt instanceof Date) {
    return observedAt.toISOString().slice(0, 10);
  }
  return observedAt.slice(0, 10);
}

export function resolvePriceFreshnessBadge(
  observation: Pick<PriceObservationLike, "observedAt" | "confidence">,
  today = maputoTodayIso(),
  staleDays = PRICE_OBSERVATION_STALE_DAYS,
): PriceFreshnessBadge {
  const ageDays = calendarDaysBetween(observationDateIso(observation.observedAt), today);
  if (ageDays > staleDays) return "desactualizado";
  if (observation.confidence === "confirmed") return "confirmado";
  return "estimado";
}

export function priceFreshnessBadgeLabel(badge: PriceFreshnessBadge): string {
  switch (badge) {
    case "confirmado":
      return "Confirmado";
    case "estimado":
      return "Estimado";
    case "desactualizado":
      return "Desactualizado";
  }
}

export function priceFreshnessBadgeClass(badge: PriceFreshnessBadge): string {
  switch (badge) {
    case "confirmado":
      return "badge-green";
    case "estimado":
      return "badge-yellow";
    case "desactualizado":
      return "badge-red";
  }
}

export function resolveEffectivePriceFromObservations<T extends PriceObservationLike & { id?: string }>(
  observations: T[],
  policy: EffectivePricePolicy,
  medianN = DEFAULT_EFFECTIVE_PRICE_MEDIAN_N,
): (EffectivePriceResult & { observationIds: string[] }) | null {
  if (policy === "manual") return null;

  const confirmed = [...observations]
    .filter((row) => row.confidence === "confirmed")
    .sort((a, b) => observationDateIso(b.observedAt).localeCompare(observationDateIso(a.observedAt)));

  if (policy === "last_confirmed") {
    const latest = confirmed[0];
    if (!latest) return null;
    return {
      policy,
      unitCost: latest.unitCost,
      observationCount: 1,
      sourceObservationIds: latest.id ? [latest.id] : [],
      observationIds: latest.id ? [latest.id] : [],
      observedAt: observationDateIso(latest.observedAt),
      source: "last_confirmed",
    };
  }

  const sample = confirmed.slice(0, Math.max(1, medianN));
  const values = sample.map((row) => row.unitCost);
  const unitCost = median(values);
  if (unitCost == null) return null;

  const ids = sample.map((row) => row.id).filter((id): id is string => Boolean(id));
  return {
    policy,
    unitCost,
    observationCount: sample.length,
    sourceObservationIds: ids,
    observationIds: ids,
    observedAt: sample[0] ? observationDateIso(sample[0].observedAt) : null,
    source: "median_n",
  };
}
