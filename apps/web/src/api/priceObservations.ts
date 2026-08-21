import { request } from "./http";
import type { EffectivePricePolicy, PriceObservationConfidence, PriceObservationResourceType } from "@sigo/shared";

export type PriceObservation = {
  id: string;
  companyId: string;
  resourceFamilyKey: string;
  resourceType: PriceObservationResourceType;
  refId: string | null;
  supplierId: string | null;
  zoneId: string | null;
  districtId: string | null;
  currency: string;
  unitCost: string;
  unit: string;
  vatIncluded: boolean;
  transportIncluded: boolean;
  observedAt: string;
  source: string;
  reference: string | null;
  confidence: PriceObservationConfidence;
  freshnessBadge: "confirmado" | "estimado" | "desactualizado";
};

export const priceObservationsApi = {
  list(params: {
    resourceFamilyKey?: string;
    resourceType?: PriceObservationResourceType;
    refId?: string;
    zoneId?: string;
    districtId?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) qs.set(key, String(value));
    }
    const query = qs.toString();
    return request<{ observations: PriceObservation[] }>(`/api/price-observations${query ? `?${query}` : ""}`);
  },

  create(body: {
    resourceFamilyKey: string;
    resourceType: PriceObservationResourceType;
    refId?: string | null;
    supplierId?: string | null;
    zoneId?: string | null;
    districtId?: string | null;
    currency?: "MZN" | "USD";
    unitCost: number;
    unit: string;
    vatIncluded?: boolean;
    transportIncluded?: boolean;
    observedAt: string;
    source: string;
    reference?: string | null;
    confidence?: PriceObservationConfidence;
  }) {
    return request<{ observation: PriceObservation }>("/api/price-observations", { method: "POST", body: JSON.stringify(body) });
  },

  effective(params: {
    resourceFamilyKey: string;
    resourceType: PriceObservationResourceType;
    zoneId?: string;
    districtId?: string;
    policy?: EffectivePricePolicy;
    medianN?: number;
  }) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) qs.set(key, String(value));
    }
    return request<{
      policy: EffectivePricePolicy;
      medianN?: number;
      effective: {
        unitCost: number;
        observationCount: number;
        sourceObservationIds: string[];
        observedAt: string | null;
        source: string | null;
      } | null;
      message?: string;
    }>(`/api/price-observations/effective?${qs.toString()}`);
  },
};
