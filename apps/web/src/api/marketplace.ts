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

export type ListMarketplaceSuppliersOptions = {
  zoneId?: string;
  q?: string;
  /** Só fornecedores com conta activa no Portal (convidáveis em RFQ formal). */
  inviteable?: boolean;
};

export const marketplaceApi = {
  listSuppliers: (zoneIdOrOptions?: string | ListMarketplaceSuppliersOptions, q?: string) => {
    const options: ListMarketplaceSuppliersOptions =
      typeof zoneIdOrOptions === "object" && zoneIdOrOptions !== null
        ? zoneIdOrOptions
        : { zoneId: zoneIdOrOptions, q };
    const params = new URLSearchParams();
    if (options.zoneId) params.set("zoneId", options.zoneId);
    if (options.q) params.set("q", options.q);
    if (options.inviteable) params.set("inviteable", "1");
    const qs = params.toString();
    return request<MarketplaceResponse>(`/marketplace/suppliers${qs ? `?${qs}` : ""}`);
  },
  supplierCatalog: (supplierId: string) => request<MarketplaceSupplierCatalog>(`/marketplace/suppliers/${supplierId}/catalog`),
};
