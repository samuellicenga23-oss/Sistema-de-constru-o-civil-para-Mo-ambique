import { request } from "./http";
import type { Supplier } from "./suppliers";

export type MarketplaceSupplier = Supplier & { zoneName: string | null; materialCount: number; labourCount: number; equipmentCount: number };

export type MarketplaceResponse =
  | { locked: true; code: string; error: string; upgradeHint?: string; actionPath?: string; count: number }
  | { locked: false; suppliers: MarketplaceSupplier[] };

export const marketplaceApi = {
  listSuppliers: (zoneId?: string) => request<MarketplaceResponse>(`/marketplace/suppliers${zoneId ? `?zoneId=${zoneId}` : ""}`),
};
