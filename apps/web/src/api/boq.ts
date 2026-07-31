import { request, ApiError } from "./http";

export type Project = {
  id: string;
  companyId: string;
  name: string;
  client: string | null;
  zoneId: string | null;
  currency: string;
  projectType: "medicao" | "orcamento" | "hibrido";
  measurementMode: "plantas" | "manual" | "importar";
  ivaRate: string;
  contingenciasRate: string;
  siteCostsRate: string;
  indirectCostsRate: string;
  profitMarginRate: string;
  createdAt: string;
};

export type ProjectMaterialSpecification = {
  id: string;
  materialId: string;
  name: string;
  unit: string;
  specification: string | null;
  baseUnitCost: string;
  currency: string;
  pricePending: boolean;
  createdMaterial?: boolean;
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
  documentType: "medicao" | "orcamento";
  sourceMeasurementDocumentId: string | null;
  revision: string | null;
  fileNumber: string | null;
  currency: string;
  status: string;
  ivaRate: string;
  contingenciasRate: string;
  siteCostsRate: string;
  indirectCostsRate: string;
  profitMarginRate: string;
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
  technicalSpecification: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  sellingUnitPrice: number | null;
  compositionId: string | null;
  origin: string;
  sortOrder: number;
  totalPrice: number;
  sellingTotalPrice: number;
  children: LineItemNode[];
};

export type SectionNode = {
  id: string;
  name: string;
  sortOrder: number;
  items: LineItemNode[];
  total: number;
  sellingTotal: number;
};

export type BudgetDocumentSummary = {
  document: BudgetDocument;
  sections: SectionNode[];
  subtotal1: number;
  siteCosts: number;
  indirectCosts: number;
  sellingSubtotal: number;
  unitPriceFactor: number;
  contingencias: number;
  profitMargin: number;
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
  getProjectWorkflow: (id: string) => request<ProjectWorkflowStatus>(`/projects/${id}/workflow`),
  createProject: (data: {
    name: string;
    client?: string;
    currency?: string;
    zoneId?: string | null;
    projectType?: "medicao" | "orcamento" | "hibrido";
    measurementMode?: "plantas" | "manual" | "importar";
    materialSpecifications?: Array<{ name: string; unit: string; specification?: string }>;
  }) =>
    request<Project & { defaultDocumentId?: string }>("/projects", { method: "POST", body: JSON.stringify(data) }),
  prepareMeasurementWorkspace: (projectId: string) =>
    request<{ document: BudgetDocument; created: boolean }>(`/projects/${projectId}/measurement-workspace`, { method: "POST" }),
  updateProject: (id: string, data: Partial<{ name: string; client: string; zoneId: string | null }>) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),
  listProjectMaterialSpecifications: (projectId: string) =>
    request<ProjectMaterialSpecification[]>(`/projects/${projectId}/material-specifications`),
  addProjectMaterialSpecification: (projectId: string, data: { name: string; unit: string; specification?: string }) =>
    request<ProjectMaterialSpecification>(`/projects/${projectId}/material-specifications`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listBudgetDocuments: (projectId: string) => request<BudgetDocument[]>(`/projects/${projectId}/budget-documents`),
  createBudgetDocument: (projectId: string, data: {
    title: string;
    currency?: string;
    template?: "padrao" | "vazio";
    documentType?: "medicao" | "orcamento";
    ivaRate?: number;
    contingenciasRate?: number;
    siteCostsRate?: number;
    indirectCostsRate?: number;
    profitMarginRate?: number;
  }) =>
    request<BudgetDocument>(`/projects/${projectId}/budget-documents`, { method: "POST", body: JSON.stringify(data) }),
  updateBudgetDocument: (id: string, data: Partial<{
    title: string;
    ivaRate: number;
    contingenciasRate: number;
    siteCostsRate: number;
    indirectCostsRate: number;
    profitMarginRate: number;
  }>) => request<BudgetDocument>(`/budget-documents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBudgetDocument: (id: string) => request<{ ok: true }>(`/budget-documents/${id}`, { method: "DELETE" }),
  createBudgetFromMeasurement: (id: string) =>
    request<{ document: BudgetDocument; created: boolean }>(`/budget-documents/${id}/create-budget`, { method: "POST" }),
  applySpecifications: (id: string) =>
    request<{ updated: number }>(`/budget-documents/${id}/apply-specifications`, { method: "POST" }),
  measurementExcelUrl: (id: string) => `/api/budget-documents/${id}/export-measurements.xlsx`,
  measurementPdfUrl: (id: string) => `/api/budget-documents/${id}/export-measurements.pdf`,

  getBudgetDocumentSummary: (id: string) => request<BudgetDocumentSummary>(`/budget-documents/${id}`),
  repriceBudgetDocument: (id: string) =>
    request<BudgetRepriceResult>(`/budget-documents/${id}/reprice`, { method: "POST" }),
  updateBudgetDocumentStatus: (id: string, status: "rascunho" | "submetido" | "aprovado") =>
    request<BudgetDocument>(`/budget-documents/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),

  createSection: (documentId: string, data: { name: string; sortOrder?: number }) =>
    request<SectionNode>(`/budget-documents/${documentId}/sections`, { method: "POST", body: JSON.stringify(data) }),

  updateSection: (id: string, data: { name: string }) =>
    request<SectionNode>(`/sections/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteSection: (id: string) => request<{ ok: true }>(`/sections/${id}`, { method: "DELETE" }),

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

  updateLineItem: (
    id: string,
    data: Partial<{ description: string; technicalSpecification: string | null; unit: string; quantity: number; unitPrice: number; compositionId: string | null }>,
  ) => request<LineItemNode>(`/line-items/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteLineItem: (id: string) => request<{ ok: true }>(`/line-items/${id}`, { method: "DELETE" }),

  bulkUpdateSpecifications: (items: Array<{ id: string; technicalSpecification: string | null }>) =>
    request<{ updated: number }>(`/line-items/bulk-specifications`, { method: "POST", body: JSON.stringify({ items }) }),

  importMeasurements: async (documentId: string, file: File, createMissing = true) => {
    const form = new FormData();
    form.append("file", file);
    const qs = createMissing ? "" : "?createMissing=false";
    const res = await fetch(`/api/budget-documents/${documentId}/import-measurements${qs}`, {
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
  itemsCreated: number;
  rowsRead: number;
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
};

export type ProjectWorkflowStatus = {
  projectId: string;
  measurementMode: string;
  projectType: string;
  guidance: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    title: string;
    message: string;
    actions: Array<{ label: string; path?: string; anchor?: string; hint?: string }>;
  }>;
};
