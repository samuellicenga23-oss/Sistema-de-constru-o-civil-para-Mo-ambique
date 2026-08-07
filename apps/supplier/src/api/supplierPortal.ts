import { request } from "./http";

export type QuoteRequestStatus = "enviado" | "respondido" | "aceite" | "recusado" | "expirado" | "cancelado";

export type QuoteRequestLine = {
  id: string;
  quoteRequestId: string;
  kind: "material" | "labour" | "equipment";
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  currency: string;
  supplierLineNotes: string | null;
  sortOrder: number;
};

export type SupplierAccount = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
};

export type SupplierPortalCompany = { companyId: string; companyName: string };

export type SupplierQuoteRequest = {
  id: string;
  companyId: string;
  companyName: string;
  companyPhone: string | null;
  supplierId: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  message: string | null;
  deadlineDate: string | null;
  status: QuoteRequestStatus;
  supplierNotes: string | null;
  respondedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  // Quem pediu — mostrado para poder ligar directamente e ajudar a fechar a venda.
  buyerName: string | null;
  buyerEmail: string | null;
};

export type SupplierQuoteRequestDetail = SupplierQuoteRequest & { lines: QuoteRequestLine[] };

export type SupplierQuoteResponseLine = { id: string; unitCost: number; notes?: string };

export type PriceZone = { id: string; name: string; province: string | null };

export type RegisterInput = { name: string; email: string; password: string; phone?: string; nuit?: string; zoneId: string };

export type MarketplaceProfile = {
  id: string;
  name: string;
  contact: string | null;
  nuit: string | null;
  zoneId: string | null;
  location: string | null;
};

export type MarketplaceMaterialPrice = {
  id: string | null;
  materialId: string;
  materialName: string;
  unit: string;
  category?: string;
  specification?: string | null;
  source?: "nacional" | "pedido";
  unitCost: string | null;
  currency: string;
};
export type MarketplaceLabourPrice = {
  id: string | null;
  labourCategoryId: string;
  labourName: string;
  hourlyCost: string | null;
  currency: string;
};
export type MarketplaceEquipmentPrice = {
  id: string | null;
  equipmentId: string;
  equipmentName: string;
  hourlyCost: string | null;
  currency: string;
};

export const publicApi = {
  zones: () => request<PriceZone[]>("/public/price-zones"),
};

export const supplierPortalAuthApi = {
  me: () => request<SupplierAccount>("/supplier/auth/me"),
  login: (email: string, password: string) => request<SupplierAccount>("/supplier/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/supplier/auth/logout", { method: "POST" }),
  acceptInvite: (token: string, password: string) =>
    request<SupplierAccount>("/supplier/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, password }) }),
  register: (data: RegisterInput) => request<SupplierAccount>("/supplier/auth/register", { method: "POST", body: JSON.stringify(data) }),
};

export const supplierPortalApi = {
  companies: () => request<SupplierPortalCompany[]>("/supplier/companies"),
  quoteRequests: () => request<SupplierQuoteRequest[]>("/supplier/quote-requests"),
  quoteRequest: (id: string) => request<SupplierQuoteRequestDetail>(`/supplier/quote-requests/${id}`),
  respond: (id: string, data: { supplierNotes?: string; lines: SupplierQuoteResponseLine[] }) =>
    request<SupplierQuoteRequest>(`/supplier/quote-requests/${id}/respond`, { method: "POST", body: JSON.stringify(data) }),
};

// Ficha e preços no marketplace nacional (SIGO Fornecedores), incluindo a Equipa SIGO Preços.
export type MarketplaceCatalog = {
  materials: Array<{ id: string; name: string; unit: string; category?: string; specification?: string | null; source?: "nacional" | "pedido" }>;
  labourCategories: Array<{ id: string; name: string }>;
  equipment: Array<{ id: string; name: string }>;
};

export const marketplaceApi = {
  catalog: () => request<MarketplaceCatalog>("/supplier/marketplace/catalog"),
  profile: () => request<MarketplaceProfile>("/supplier/marketplace/profile"),
  updateProfile: (data: { name: string; contact?: string; nuit?: string; zoneId: string }) =>
    request<MarketplaceProfile>("/supplier/marketplace/profile", { method: "PUT", body: JSON.stringify(data) }),

  listMaterials: () => request<MarketplaceMaterialPrice[]>("/supplier/marketplace/materials"),
  setMaterial: (data: { materialId: string; unitCost: number; currency?: string }) =>
    request<MarketplaceMaterialPrice>("/supplier/marketplace/materials", { method: "PUT", body: JSON.stringify(data) }),
  deleteMaterial: (priceId: string) => request<{ ok: true }>(`/supplier/marketplace/materials/${priceId}`, { method: "DELETE" }),

  listLabour: () => request<MarketplaceLabourPrice[]>("/supplier/marketplace/labour"),
  setLabour: (data: { labourCategoryId: string; hourlyCost: number; currency?: string }) =>
    request<MarketplaceLabourPrice>("/supplier/marketplace/labour", { method: "PUT", body: JSON.stringify(data) }),
  deleteLabour: (priceId: string) => request<{ ok: true }>(`/supplier/marketplace/labour/${priceId}`, { method: "DELETE" }),

  listEquipment: () => request<MarketplaceEquipmentPrice[]>("/supplier/marketplace/equipment"),
  setEquipment: (data: { equipmentId: string; hourlyCost: number; currency?: string }) =>
    request<MarketplaceEquipmentPrice>("/supplier/marketplace/equipment", { method: "PUT", body: JSON.stringify(data) }),
  deleteEquipment: (priceId: string) => request<{ ok: true }>(`/supplier/marketplace/equipment/${priceId}`, { method: "DELETE" }),
};

export type SupplierNotification = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
export type SupplierNotificationsResponse = { items: SupplierNotification[]; unreadCount: number };

export const supplierNotificationsApi = {
  list: () => request<SupplierNotificationsResponse>("/supplier/notifications"),
  markRead: (id: string) => request<{ ok: true }>(`/supplier/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => request<{ ok: true }>("/supplier/notifications/read-all", { method: "POST" }),
};
