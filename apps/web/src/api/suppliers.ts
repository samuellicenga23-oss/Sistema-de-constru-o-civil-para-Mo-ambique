import { request } from "./http";

export type Supplier = {
  id: string;
  companyId: string;
  name: string;
  contact: string | null;
  location: string | null;
  nuit: string | null;
  notes: string | null;
  createdAt: string;
};

export type SupplierInput = { name: string; contact?: string; location?: string; nuit?: string; notes?: string };

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

export const suppliersApi = {
  list: () => request<Supplier[]>("/suppliers"),
  create: (data: SupplierInput) => request<Supplier>("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<SupplierInput>) => request<Supplier>(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/suppliers/${id}`, { method: "DELETE" }),

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
};
