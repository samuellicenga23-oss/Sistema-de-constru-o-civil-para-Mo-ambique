import { request, ApiError } from "./http";

export type Project = {
  id: string;
  companyId: string;
  name: string;
  client: string | null;
  zoneId: string | null;
  currency: string;
  ivaRate: string;
  contingenciasRate: string;
  createdAt: string;
};

export type CalculationSource = "real" | "medido" | "estimativa";

export type CalculationReportEntry = {
  code: string;
  label: string;
  unit: string;
  value: number;
  source: CalculationSource;
  formula: string;
};

export type CalculationReport = {
  generatedAt: string;
  entries: CalculationReportEntry[];
};

export type BudgetDocument = {
  id: string;
  projectId: string;
  title: string;
  revision: string | null;
  fileNumber: string | null;
  currency: string;
  status: string;
  ivaRate: string;
  contingenciasRate: string;
  lastEstimateReport: CalculationReport | null;
};

export type LineItemKind = "capitulo" | "grupo" | "item" | "nota";

export type LineItemNode = {
  id: string;
  sectionId: string;
  parentId: string | null;
  kind: LineItemKind;
  code: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  compositionId: string | null;
  origin: string;
  sortOrder: number;
  totalPrice: number;
  children: LineItemNode[];
};

export type SectionNode = {
  id: string;
  name: string;
  sortOrder: number;
  items: LineItemNode[];
  total: number;
};

export type BudgetDocumentSummary = {
  document: BudgetDocument;
  sections: SectionNode[];
  subtotal1: number;
  contingencias: number;
  subtotal2: number;
  iva: number;
  total: number;
};

export type BudgetRepriceResult = {
  processed: number;
  updated: number;
  unchanged: number;
  previousTotal: number;
  newTotal: number;
  zoneId: string | null;
};

export const boqApi = {
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: { name: string; client?: string; currency?: string; zoneId?: string | null }) =>
    request<Project & { defaultDocumentId?: string }>("/projects", { method: "POST", body: JSON.stringify(data) }),
  prepareMeasurementWorkspace: (projectId: string) =>
    request<{ document: BudgetDocument; created: boolean }>(`/projects/${projectId}/measurement-workspace`, { method: "POST" }),
  updateProject: (id: string, data: Partial<{ name: string; client: string; zoneId: string | null }>) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),

  listBudgetDocuments: (projectId: string) => request<BudgetDocument[]>(`/projects/${projectId}/budget-documents`),
  createBudgetDocument: (projectId: string, data: { title: string; currency?: string; template?: "padrao" | "vazio" }) =>
    request<BudgetDocument>(`/projects/${projectId}/budget-documents`, { method: "POST", body: JSON.stringify(data) }),
  deleteBudgetDocument: (id: string) => request<{ ok: true }>(`/budget-documents/${id}`, { method: "DELETE" }),

  getBudgetDocumentSummary: (id: string) => request<BudgetDocumentSummary>(`/budget-documents/${id}`),
  repriceBudgetDocument: (id: string) =>
    request<BudgetRepriceResult>(`/budget-documents/${id}/reprice`, { method: "POST" }),

  createSection: (documentId: string, data: { name: string; sortOrder?: number }) =>
    request<SectionNode>(`/budget-documents/${documentId}/sections`, { method: "POST", body: JSON.stringify(data) }),

  createLineItem: (
    sectionId: string,
    data: {
      parentId?: string | null;
      kind: LineItemKind;
      code?: string | null;
      description: string;
      unit?: string | null;
      quantity?: number | null;
      unitPrice?: number | null;
      compositionId?: string | null;
      sortOrder?: number;
    }
  ) => request<LineItemNode>(`/sections/${sectionId}/line-items`, { method: "POST", body: JSON.stringify(data) }),

  updateLineItem: (id: string, data: Partial<{ description: string; unit: string; quantity: number; unitPrice: number }>) =>
    request<LineItemNode>(`/line-items/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteLineItem: (id: string) => request<{ ok: true }>(`/line-items/${id}`, { method: "DELETE" }),

  importMeasurements: async (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/budget-documents/${documentId}/import-measurements`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<MeasurementImportResult>;
  },
};

export type MeasurementImportResult = {
  itemsUpdated: number;
  rowsRead: number;
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
};
