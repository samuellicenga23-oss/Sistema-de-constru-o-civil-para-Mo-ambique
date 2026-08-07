import { request } from "./http";

export type Supplier = {
  id: string;
  companyId: string | null;
  name: string;
  contact: string | null;
  location: string | null;
  nuit: string | null;
  notes: string | null;
  zoneId: string | null;
  supplierAccountId: string | null;
  createdAt: string;
  isReference: boolean;
  referenceMaterialCount: number | null;
  referenceDate: string | null;
};

export type SupplierMaterialPrice = {
  id: string;
  supplierId: string;
  materialId: string;
  materialName: string;
  unit: string;
  zoneId: string | null;
  zoneName: string | null;
  unitCost: string;
  currency: string;
  materialSourceName: string | null;
  materialPriceDate: string | null;
};

export type SupplierMaterialPriceInput = { materialId: string; zoneId?: string | null; unitCost: number; currency?: string };

export type SupplierLabourPrice = {
  id: string;
  supplierId: string;
  labourCategoryId: string;
  labourName: string;
  zoneId: string | null;
  zoneName: string | null;
  hourlyCost: string;
  currency: string;
};
export type SupplierLabourPriceInput = { labourCategoryId: string; zoneId?: string | null; hourlyCost: number; currency?: string };

export type SupplierEquipmentPrice = {
  id: string;
  supplierId: string;
  equipmentId: string;
  equipmentName: string;
  zoneId: string | null;
  zoneName: string | null;
  hourlyCost: string;
  currency: string;
};
export type SupplierEquipmentPriceInput = { equipmentId: string; zoneId?: string | null; hourlyCost: number; currency?: string };

export type SupplierPriceFeed = {
  id: string;
  supplierId: string;
  feedUrl: string;
  hasApiKey: boolean;
  isActive: boolean;
  intervalHours: number;
  lastSyncAt: string | null;
  lastSyncStatus: "sucesso" | "erro" | null;
  lastSyncError: string | null;
  lastSyncMatched: number | null;
  lastSyncUnmatched: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierPriceFeedInput = { feedUrl: string; apiKey?: string; intervalHours: number; isActive: boolean };

export const suppliersApi = {
  // A empresa deixou de gerir fornecedores próprios — "list" só devolve a ficha SIGO Preços. Para
  // o marketplace nacional de fornecedores reais, ver api/marketplace.ts.
  list: () => request<Supplier[]>("/suppliers"),

  listMaterialPrices: (supplierId: string) => request<SupplierMaterialPrice[]>(`/suppliers/${supplierId}/materials`),
  setMaterialPrice: (supplierId: string, data: SupplierMaterialPriceInput) =>
    request<SupplierMaterialPrice>(`/suppliers/${supplierId}/materials`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMaterialPrice: (supplierId: string, priceId: string) =>
    request<{ ok: true }>(`/suppliers/${supplierId}/materials/${priceId}`, { method: "DELETE" }),

  listLabourPrices: (supplierId: string) => request<SupplierLabourPrice[]>(`/suppliers/${supplierId}/labour`),
  setLabourPrice: (supplierId: string, data: SupplierLabourPriceInput) =>
    request<SupplierLabourPrice>(`/suppliers/${supplierId}/labour`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLabourPrice: (supplierId: string, priceId: string) =>
    request<{ ok: true }>(`/suppliers/${supplierId}/labour/${priceId}`, { method: "DELETE" }),

  listEquipmentPrices: (supplierId: string) => request<SupplierEquipmentPrice[]>(`/suppliers/${supplierId}/equipment`),
  setEquipmentPrice: (supplierId: string, data: SupplierEquipmentPriceInput) =>
    request<SupplierEquipmentPrice>(`/suppliers/${supplierId}/equipment`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEquipmentPrice: (supplierId: string, priceId: string) =>
    request<{ ok: true }>(`/suppliers/${supplierId}/equipment/${priceId}`, { method: "DELETE" }),

  getPriceFeed: (supplierId: string) => request<SupplierPriceFeed | null>(`/suppliers/${supplierId}/price-feed`),
  setPriceFeed: (supplierId: string, data: SupplierPriceFeedInput) =>
    request<SupplierPriceFeed>(`/suppliers/${supplierId}/price-feed`, { method: "PUT", body: JSON.stringify(data) }),
  deletePriceFeed: (supplierId: string) => request<{ ok: true }>(`/suppliers/${supplierId}/price-feed`, { method: "DELETE" }),
  syncPriceFeedNow: (supplierId: string) =>
    request<{ ok: true; matched: number; unmatched: number }>(`/suppliers/${supplierId}/price-feed/sync`, { method: "POST" }),
};
