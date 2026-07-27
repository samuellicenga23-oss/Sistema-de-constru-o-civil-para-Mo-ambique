import { request } from "./http";

export type LabourCategory = {
  id: string;
  companyId: string | null;
  name: string;
  monthlySalary: string;
  hourlyRate: string;
  currency: string;
};

export type Material = {
  id: string;
  companyId: string | null;
  name: string;
  unit: string;
  baseUnitCost: string;
  importFactor: string;
  currency: string;
  // Só vem preenchido quando `listMaterials` é chamado com um zoneId — preço próprio desta
  // zona, se existir; null = usa o preço base.
  zonePrice?: string | null;
  // Melhor cotação de fornecedor aplicável à zona pedida. É apenas uma sugestão de mercado;
  // só passa a alimentar composições quando o utilizador a adoptar explicitamente no Catálogo.
  marketPrice?: string | null;
  marketCurrency?: string | null;
  marketSupplierId?: string | null;
  marketSupplierName?: string | null;
  marketPriceIsZoneSpecific?: boolean;
  // Unidade de compra de mercado (ex: "Camião 10m³"), quando difere da unidade de medida —
  // null = compra-se directamente na unidade de medida, sem conversão.
  purchasePackageLabel: string | null;
  purchasePackageQty: string | null;
};

export type CostComposition = {
  id: string;
  companyId: string | null;
  name: string;
  category: string;
  outputUnit: string;
  currency: string;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  unitCost: number;
};

export type CompositionLineDetail = {
  id: string;
  refId: string;
  qtyPerUnit: string;
  name: string;
  unitCost: string;
  importFactor?: string;
  unit?: string;
};

export type CostCompositionDetail = CostComposition & {
  labourLines: CompositionLineDetail[];
  materialLines: CompositionLineDetail[];
  equipmentLines: CompositionLineDetail[];
};

export type Equipment = {
  id: string;
  companyId: string | null;
  name: string;
  unit: string;
  hourlyCost: string;
  currency: string;
};

export type PriceZone = {
  id: string;
  companyId: string | null;
  name: string;
};

export type MaterialZonePrice = {
  id: string;
  materialId: string;
  zoneId: string;
  unitCost: string;
};

export type CompositionSaveInput = {
  name: string;
  category: string;
  outputUnit: string;
  currency: string;
  labourLines: Array<{ refId: string; qtyPerUnit: number }>;
  materialLines: Array<{ refId: string; qtyPerUnit: number }>;
  equipmentLines: Array<{ refId: string; qtyPerUnit: number }>;
};

export const catalogApi = {
  // Editar um preço partilhado clona-o automaticamente em segundo plano — nunca é preciso
  // um passo explícito de "clonar" no frontend.
  listLabourCategories: () => request<LabourCategory[]>("/catalog/labour-categories"),
  createLabourCategory: (data: { name: string; monthlySalary: number }) =>
    request<LabourCategory>("/catalog/labour-categories", { method: "POST", body: JSON.stringify(data) }),
  updateLabourCategory: (id: string, data: { name?: string; monthlySalary?: number }) =>
    request<LabourCategory>(`/catalog/labour-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLabourCategory: (id: string) =>
    request<{ ok: true }>(`/catalog/labour-categories/${id}`, { method: "DELETE" }),

  listMaterials: (zoneId?: string) => request<Material[]>(`/catalog/materials${zoneId ? `?zoneId=${zoneId}` : ""}`),
  createMaterial: (data: { name: string; unit: string; baseUnitCost: number; importFactor?: number }) =>
    request<Material>("/catalog/materials", { method: "POST", body: JSON.stringify(data) }),
  updateMaterial: (
    id: string,
    data: Partial<{ name: string; baseUnitCost: number; importFactor: number; purchasePackageLabel: string | null; purchasePackageQty: number | null }>
  ) => request<Material>(`/catalog/materials/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMaterial: (id: string) => request<{ ok: true }>(`/catalog/materials/${id}`, { method: "DELETE" }),

  listCompositions: (zoneId?: string) => request<CostComposition[]>(`/catalog/compositions${zoneId ? `?zoneId=${zoneId}` : ""}`),
  getComposition: (id: string) => request<CostCompositionDetail>(`/catalog/compositions/${id}`),
  createComposition: (data: CompositionSaveInput) =>
    request<CostComposition>("/catalog/compositions", { method: "POST", body: JSON.stringify(data) }),
  updateComposition: (id: string, data: CompositionSaveInput) =>
    request<CostComposition>(`/catalog/compositions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteComposition: (id: string) => request<{ ok: true }>(`/catalog/compositions/${id}`, { method: "DELETE" }),
  listEquipment: () => request<Equipment[]>("/catalog/equipment"),

  listPriceZones: () => request<PriceZone[]>("/catalog/price-zones"),
  createPriceZone: (data: { name: string }) => request<PriceZone>("/catalog/price-zones", { method: "POST", body: JSON.stringify(data) }),
  updatePriceZone: (id: string, data: { name: string }) =>
    request<PriceZone>(`/catalog/price-zones/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePriceZone: (id: string) => request<{ ok: true }>(`/catalog/price-zones/${id}`, { method: "DELETE" }),

  listMaterialZonePrices: (materialId: string) => request<MaterialZonePrice[]>(`/catalog/materials/${materialId}/zone-prices`),
  setMaterialZonePrice: (materialId: string, zoneId: string, unitCost: number) =>
    request<MaterialZonePrice>(`/catalog/materials/${materialId}/zone-prices/${zoneId}`, { method: "PUT", body: JSON.stringify({ unitCost }) }),
  deleteMaterialZonePrice: (materialId: string, zoneId: string) =>
    request<{ ok: true }>(`/catalog/materials/${materialId}/zone-prices/${zoneId}`, { method: "DELETE" }),

  listMaterialSuppliers: (materialId: string) =>
    request<Array<{ id: string; supplierId: string; supplierName: string; zoneId: string | null; zoneName: string | null; unitCost: string; currency: string }>>(
      `/catalog/materials/${materialId}/suppliers`
    ),
  listLabourSuppliers: (labourCategoryId: string) =>
    request<Array<{ id: string; supplierId: string; supplierName: string; zoneId: string | null; zoneName: string | null; hourlyCost: string; currency: string }>>(
      `/catalog/labour-categories/${labourCategoryId}/suppliers`
    ),
  listEquipmentSuppliers: (equipmentId: string) =>
    request<Array<{ id: string; supplierId: string; supplierName: string; zoneId: string | null; zoneName: string | null; hourlyCost: string; currency: string }>>(
      `/catalog/equipment/${equipmentId}/suppliers`
    ),
};
