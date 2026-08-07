import { request } from "./http";

export type LabourCategory = {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  monthlySalary: string;
  productiveHoursPerMonth: string | null;
  socialChargesPct: string;
  complementaryCostsPct: string;
  hourlyRate: string;
  currency: "MZN" | "USD";
  sourceName: string | null;
  sourceReference: string | null;
  effectiveDate: string | null;
  isActive: boolean;
  updatedAt: string;
};

export type Material = {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  category: string;
  specification: string | null;
  unit: string;
  baseUnitCost: string;
  importFactor: string;
  defaultWastePct: string;
  currency: string;
  priceSourceName: string | null;
  sourceReference: string | null;
  priceDate: string | null;
  includesVat: boolean;
  isActive: boolean;
  updatedAt: string;
  // Só vem preenchido quando `listMaterials` é chamado com um zoneId — preço próprio desta
  // zona, se existir; null = usa o preço base.
  zonePrice?: string | null;
  zonePriceSourceName?: string | null;
  zonePriceEffectiveDate?: string | null;
  effectiveUnitCost: number;
  priceBasis: "base" | "zone_adjusted_base" | "zone_specific";
  // Melhor cotação de fornecedor aplicável à zona pedida. É apenas uma sugestão de mercado;
  // só passa a alimentar composições quando o utilizador a adoptar explicitamente no Catálogo.
  marketPrice?: string | null;
  marketCurrency?: string | null;
  marketSupplierId?: string | null;
  marketSupplierName?: string | null;
  marketPriceIsReference?: boolean;
  marketPriceIsZoneSpecific?: boolean;
  // Unidade de compra de mercado (ex: "Camião 10m³"), quando difere da unidade de medida —
  // null = compra-se directamente na unidade de medida, sem conversão.
  purchasePackageLabel: string | null;
  purchasePackageQty: string | null;
};

export type CostComposition = {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  category: string;
  description: string | null;
  measurementCriteria: string | null;
  executionNotes: string | null;
  outputUnit: string;
  currency: "MZN" | "USD";
  auxiliaryCostPct: string;
  indirectCostPct: string;
  profitMarginPct: string;
  version: number;
  sourceName: string | null;
  sourceReference: string | null;
  isActive: boolean;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  directCost: number;
  auxiliaryCost: number;
  indirectCost: number;
  profit: number;
  unitCost: number;
  qualityScore: number;
  qualityWarnings: string[];
  isReady: boolean;
};

export type CompositionLineDetail = {
  id: string;
  refId: string;
  qtyPerUnit: string;
  wastePct?: string;
  notes?: string | null;
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
  province: string | null;
  district: string | null;
  description: string | null;
  materialAdjustmentPct: string;
  labourAdjustmentPct: string;
  equipmentAdjustmentPct: string;
  defaultTransportPct: string;
  sourceName: string | null;
  sourceReference: string | null;
  effectiveDate: string | null;
  updatedAt: string;
};

export type WorkChapterItem = {
  code: string;
  description: string;
  unit: string;
  composition?: string;
  compositionId?: string | null;
};

export type WorkChapter = {
  code: string;
  name: string;
  discipline: "all" | "arquitectura" | "estrutura" | "hidrossanitario" | "electricidade" | "outro";
  detectionTags: string[];
  requiresTagMatch: boolean;
  version: number;
  companyId: string | null;
  items: WorkChapterItem[];
};

export type WorkChapterInput = {
  code: string;
  name: string;
  discipline: WorkChapter["discipline"];
  detectionTags: string[];
  requiresTagMatch: boolean;
  chapterSortOrder?: number;
  items: Array<{ code: string; description: string; unit: string; compositionId?: string | null }>;
};

export type MaterialZonePrice = {
  id: string;
  materialId: string;
  zoneId: string;
  unitCost: string;
  sourceName: string | null;
  sourceReference: string | null;
  effectiveDate: string | null;
  includesVat: boolean;
  transportIncluded: boolean;
};

export type CompositionSaveInput = {
  name: string;
  category: string;
  code?: string | null;
  description?: string | null;
  measurementCriteria?: string | null;
  executionNotes?: string | null;
  outputUnit: string;
  currency: string;
  auxiliaryCostPct?: number;
  indirectCostPct?: number;
  profitMarginPct?: number;
  sourceName?: string | null;
  sourceReference?: string | null;
  isActive?: boolean;
  labourLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
  materialLines: Array<{ refId: string; qtyPerUnit: number; wastePct?: number; notes?: string | null }>;
  equipmentLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
};

export type LabourCategoryInput = {
  code?: string | null;
  name: string;
  monthlySalary: number;
  productiveHoursPerMonth?: number | null;
  socialChargesPct?: number;
  complementaryCostsPct?: number;
  sourceName?: string | null;
  sourceReference?: string | null;
  effectiveDate?: string | null;
  isActive?: boolean;
};

export type MaterialInput = {
  code?: string | null;
  name: string;
  category?: string;
  specification?: string | null;
  unit: string;
  baseUnitCost: number;
  importFactor?: number;
  defaultWastePct?: number;
  priceSourceName?: string | null;
  sourceReference?: string | null;
  priceDate?: string | null;
  includesVat?: boolean;
  isActive?: boolean;
  purchasePackageLabel?: string | null;
  purchasePackageQty?: number | null;
};

export type PriceZoneInput = {
  name: string;
  province?: string | null;
  district?: string | null;
  description?: string | null;
  materialAdjustmentPct?: number;
  labourAdjustmentPct?: number;
  equipmentAdjustmentPct?: number;
  defaultTransportPct?: number;
  sourceName?: string | null;
  sourceReference?: string | null;
  effectiveDate?: string | null;
};

export const catalogApi = {
  // Editar um preço partilhado clona-o automaticamente em segundo plano — nunca é preciso
  // um passo explícito de "clonar" no frontend.
  listLabourCategories: () => request<LabourCategory[]>("/catalog/labour-categories"),
  createLabourCategory: (data: LabourCategoryInput) =>
    request<LabourCategory>("/catalog/labour-categories", { method: "POST", body: JSON.stringify(data) }),
  updateLabourCategory: (id: string, data: Partial<LabourCategoryInput>) =>
    request<LabourCategory>(`/catalog/labour-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLabourCategory: (id: string) =>
    request<{ ok: true }>(`/catalog/labour-categories/${id}`, { method: "DELETE" }),

  listMaterials: (zoneId?: string) => request<Material[]>(`/catalog/materials${zoneId ? `?zoneId=${zoneId}` : ""}`),
  createMaterial: (data: MaterialInput) =>
    request<Material>("/catalog/materials", { method: "POST", body: JSON.stringify(data) }),
  updateMaterial: (
    id: string,
    data: Partial<MaterialInput>
  ) => request<Material>(`/catalog/materials/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMaterial: (id: string) => request<{ ok: true }>(`/catalog/materials/${id}`, { method: "DELETE" }),

  listCompositions: (zoneId?: string) => request<CostComposition[]>(`/catalog/compositions${zoneId ? `?zoneId=${zoneId}` : ""}`),
  getComposition: (id: string, zoneId?: string) => request<CostCompositionDetail>(`/catalog/compositions/${id}${zoneId ? `?zoneId=${zoneId}` : ""}`),
  createComposition: (data: CompositionSaveInput) =>
    request<CostComposition>("/catalog/compositions", { method: "POST", body: JSON.stringify(data) }),
  updateComposition: (id: string, data: CompositionSaveInput) =>
    request<CostComposition>(`/catalog/compositions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteComposition: (id: string) => request<{ ok: true }>(`/catalog/compositions/${id}`, { method: "DELETE" }),
  listEquipment: () => request<Equipment[]>("/catalog/equipment"),

  listPriceZones: () => request<PriceZone[]>("/catalog/price-zones"),
  createPriceZone: (data: PriceZoneInput) => request<PriceZone>("/catalog/price-zones", { method: "POST", body: JSON.stringify(data) }),
  updatePriceZone: (id: string, data: Partial<PriceZoneInput>) =>
    request<PriceZone>(`/catalog/price-zones/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePriceZone: (id: string) => request<{ ok: true }>(`/catalog/price-zones/${id}`, { method: "DELETE" }),

  listMaterialZonePrices: (materialId: string) => request<MaterialZonePrice[]>(`/catalog/materials/${materialId}/zone-prices`),
  setMaterialZonePrice: (materialId: string, zoneId: string, data: number | { unitCost: number; sourceName?: string | null; sourceReference?: string | null; effectiveDate?: string | null; includesVat?: boolean; transportIncluded?: boolean }) =>
    request<MaterialZonePrice>(`/catalog/materials/${materialId}/zone-prices/${zoneId}`, { method: "PUT", body: JSON.stringify(typeof data === "number" ? { unitCost: data } : data) }),
  deleteMaterialZonePrice: (materialId: string, zoneId: string) =>
    request<{ ok: true }>(`/catalog/materials/${materialId}/zone-prices/${zoneId}`, { method: "DELETE" }),

  listWorkChapters: () => request<WorkChapter[]>("/catalog/work-chapters"),
  createWorkChapter: (data: WorkChapterInput) =>
    request<WorkChapter>("/catalog/work-chapters", { method: "POST", body: JSON.stringify(data) }),
  updateWorkChapter: (code: string, data: WorkChapterInput) =>
    request<WorkChapter>(`/catalog/work-chapters/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteWorkChapter: (code: string) =>
    request<{ ok: true }>(`/catalog/work-chapters/${encodeURIComponent(code)}`, { method: "DELETE" }),

  listMaterialSuppliers: (materialId: string) =>
    request<Array<{ id: string; supplierId: string; supplierName: string; supplierContact: string | null; zoneId: string | null; zoneName: string | null; unitCost: string; currency: string; isReference?: boolean; isMarketplace?: boolean }>>(
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
