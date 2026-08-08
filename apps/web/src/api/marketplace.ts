import { request } from "./http";
import type { Supplier } from "./suppliers";

export type MarketplaceSupplier = Supplier & {
  zoneName: string | null;
  materialCount: number;
  labourCount: number;
  equipmentCount: number;
  matchedMaterials?: string[];
  offersMaterials?: boolean;
  offersLabour?: boolean;
  offersEquipment?: boolean;
};

export type MarketplaceResponse =
  | { locked: true; code: string; error: string; upgradeHint?: string; actionPath?: string; count: number; materialMatches?: unknown[] }
  | { locked: false; suppliers: MarketplaceSupplier[]; materialMatches?: unknown[] };

export type MarketplaceSupplierCatalog = {
  supplier: { id: string; name: string; location: string | null };
  materials: Array<{
    id: string;
    name: string;
    unit: string;
    category: string | null;
    specification: string | null;
    unitCost: string | null;
    currency: string;
  }>;
};

export const marketplaceApi = {
  listSuppliers: (zoneId?: string, q?: string) => {
    const params = new URLSearchParams();
    if (zoneId) params.set("zoneId", zoneId);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<MarketplaceResponse>(`/marketplace/suppliers${qs ? `?${qs}` : ""}`);
  },
  supplierCatalog: (supplierId: string) => request<MarketplaceSupplierCatalog>(`/marketplace/suppliers/${supplierId}/catalog`),
};
