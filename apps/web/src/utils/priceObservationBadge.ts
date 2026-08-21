import {
  priceFreshnessBadgeClass,
  priceFreshnessBadgeLabel,
  resolvePriceFreshnessBadge,
  type PriceFreshnessBadge,
  type PriceObservationConfidence,
} from "@sigo/shared";

export type PriceObservationSummary = {
  observedAt: string;
  source: string;
  confidence: PriceObservationConfidence;
};

export function getPriceObservationBadge(observation: Pick<PriceObservationSummary, "observedAt" | "confidence">): {
  badge: PriceFreshnessBadge;
  label: string;
  className: string;
} {
  const badge = resolvePriceFreshnessBadge({
    observedAt: observation.observedAt,
    confidence: observation.confidence,
  });
  return {
    badge,
    label: priceFreshnessBadgeLabel(badge),
    className: priceFreshnessBadgeClass(badge),
  };
}

export function formatObservationDate(iso: string): string {
  const date = iso.slice(0, 10);
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
