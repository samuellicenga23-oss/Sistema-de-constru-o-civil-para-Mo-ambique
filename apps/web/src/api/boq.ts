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
  floors: number;
  ivaRate: string;
  contingenciasRate: string;
  siteCostsRate: string;
  indirectCostsRate: string;
  profitMarginRate: string;
  createdAt: string;
};

export type SchedulePhaseSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: "nao_iniciado" | "em_curso" | "concluido" | "bloqueado";
};

export type SiteManagementOverview = {
  projectId: string;
  projectName: string;
  currency: string;
  expectedProgress: number;
  actualProgress: number;
  progressGap: number;
  contractedValue: number;
  receivedValue: number;
  cashMargin: number;
  alerts: Array<{ code: string; level: "critical" | "warning" | "info"; title: string; detail: string; href: string }>;
  schedule: { startDate: string | null; endDate: string | null; phases: SchedulePhaseSummary[] };
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
  submittedByUserId: string | null;
  approvedByUserId: string | null;
  approvalNote: string | null;
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
  templateKey: string | null;
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

export type LineItemCostSnapshot = {
  id: string;
  lineItemId: string;
  compositionId: string | null;
  compositionVersion: number | null;
  zoneId: string | null;
  currency: string;
  unitCost: number;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  subcompositionCost: number;
  derivedCost: number;
  resourceSnapshot: {
    schemaVersion?: number;
    capturedAt?: string;
    composition?: {
      id?: string;
      code?: string | null;
      name?: string;
      version?: number;
      outputUnit?: string;
      sourceName?: string | null;
      productivitySource?: string | null;
      outputPerDay?: string | number | null;
      crewSize?: number | null;
    };
    labour?: Array<{ name: string; hoursPerUnit: number; hourlyRate: number; priceSourceName?: string | null; priceDate?: string | null }>;
    materials?: Array<{ name: string; unit: string; qtyPerUnit: number; unitCost: number; priceSourceName?: string | null; priceDate?: string | null; priceOrigin?: string }>;
    equipment?: Array<{ name: string; hoursPerUnit: number; hourlyCost: number; priceSourceName?: string | null; priceDate?: string | null }>;
    derivedCosts?: Array<{ name: string; basis: string; percentage: number }>;
    computed?: {
      labourCost?: number;
      materialCost?: number;
      equipmentCost?: number;
      subcompositionCost?: number;
      derivedCost?: number;
      unitCost?: number;
      productivity?: { outputPerDay?: number | null; basis?: string };
    };
  } | null;
  reason: string;
  createdAt: string;
};

export const boqApi = {
  listProjects: () => request<Project[]>("/projects"),
  listProjectsReadyForSite: () => request<Project[]>("/projects?readyForSite=1"),
  siteManagementOverview: () => request<SiteManagementOverview[]>("/projects/site-management-overview"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  getProjectWorkflow: (id: string) => request<ProjectWorkflowStatus>(`/projects/${id}/workflow`),
  createProject: (data: {
    name: string;
    client?: string;
    currency?: string;
    zoneId?: string | null;
    projectType?: "medicao" | "orcamento" | "hibrido";
    measurementMode?: "plantas" | "manual" | "importar";
    floors?: number;
    materialSpecifications?: Array<{ name: string; unit: string; specification?: string }>;
  }) =>
    request<Project & { defaultDocumentId?: string }>("/projects", { method: "POST", body: JSON.stringify(data) }),
  prepareMeasurementWorkspace: (projectId: string) =>
    request<{ document: BudgetDocument; created: boolean }>(`/projects/${projectId}/measurement-workspace`, { method: "POST" }),
  updateProject: (id: string, data: Partial<{ name: string; client: string; zoneId: string | null; floors: number }>) =>
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
  createBudgetFromMeasurement: (
    id: string,
    options: boolean | { createRevision?: boolean; createScenario?: boolean } = false,
  ) => {
    const body =
      typeof options === "boolean"
        ? { createRevision: options, createScenario: false }
        : { createRevision: options.createRevision ?? false, createScenario: options.createScenario ?? false };
    return request<{ document: BudgetDocument; created: boolean; revisionCreated?: boolean; scenarioCreated?: boolean }>(
      `/budget-documents/${id}/create-budget`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  reviseBudgetDocument: (id: string) =>
    request<{ document: BudgetDocument; sourceDocumentId: string }>(`/budget-documents/${id}/revise`, {
      method: "POST",
    }),
  duplicateMeasurement: (id: string) =>
    request<{ document: BudgetDocument; sourceDocumentId: string }>(`/budget-documents/${id}/duplicate`, {
      method: "POST",
    }),
  applySpecifications: (id: string) =>
    request<{ updated: number }>(`/budget-documents/${id}/apply-specifications`, { method: "POST" }),
  measurementExcelUrl: (id: string) => `/api/budget-documents/${id}/export-measurements.xlsx`,
  measurementPdfUrl: (id: string) => `/api/budget-documents/${id}/export-measurements.pdf`,

  getBudgetDocumentSummary: (id: string) => request<BudgetDocumentSummary>(`/budget-documents/${id}`),
  repriceBudgetDocument: (id: string) =>
    request<BudgetRepriceResult>(`/budget-documents/${id}/reprice`, { method: "POST" }),
  updateBudgetDocumentStatus: (id: string, status: "rascunho" | "submetido" | "aprovado", decisionNote?: string) =>
    request<BudgetDocument>(`/budget-documents/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, decisionNote }) }),

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

  listCostSnapshots: (lineItemId: string) =>
    request<{
      lineItemId: string;
      compositionId: string | null;
      latest: LineItemCostSnapshot | null;
      snapshots: LineItemCostSnapshot[];
    }>(`/line-items/${lineItemId}/cost-snapshots`),

  bulkUpdateSpecifications: (items: Array<{ id: string; technicalSpecification: string | null }>) =>
    request<{ updated: number }>(`/line-items/bulk-specifications`, { method: "POST", body: JSON.stringify({ items }) }),

  previewMeasurementImport: async (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/budget-documents/${documentId}/import-measurements/preview`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<MeasurementImportPreview>;
  },

  /** Envia o mapa e analisa em segundo plano (como as plantas). */
  startMeasurementImportJob: async (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/budget-documents/${documentId}/import-measurements/jobs`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<MeasurementImportJob>;
  },

  getMeasurementImportJob: (documentId: string, jobId: string) =>
    request<MeasurementImportJob>(`/budget-documents/${documentId}/import-measurements/jobs/${jobId}`),

  applyMeasurementImport: async (
    documentId: string,
    fileOrJob: File | { jobId: string },
    decisions: ImportApplyDecision[],
    saveToCompanyTemplate = false,
  ) => {
    const form = new FormData();
    if (fileOrJob instanceof File) form.append("file", fileOrJob);
    else form.append("jobId", fileOrJob.jobId);
    form.append("decisions", JSON.stringify(decisions));
    form.append("saveToCompanyTemplate", saveToCompanyTemplate ? "true" : "false");
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), 180_000) : null;
    try {
      const res = await fetch(`/api/budget-documents/${documentId}/import-measurements/apply`, {
        method: "POST",
        credentials: "include",
        body: form,
        signal: controller?.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
      }
      return res.json() as Promise<MeasurementImportResult>;
    } catch (error) {
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new ApiError(408, "A aplicação demorou demasiado. Tente novamente — o mapa já está analisado.");
      }
      throw error;
    } finally {
      if (timer != null) window.clearTimeout(timer);
    }
  },
};

export type MeasurementImportJob = {
  id: string;
  companyId: string;
  documentId: string;
  fileName: string;
  status: "pendente" | "processando" | "concluido" | "erro";
  progress: number;
  stage: string;
  errorMessage: string | null;
  preview: MeasurementImportPreview | null;
  createdAt: number;
  updatedAt: number;
};

export type CreatedImportComposition = {
  id: string;
  name: string;
  itemCodes: string[];
};

export type MeasurementImportResult = {
  itemsUpdated: number;
  itemsCreated: number;
  rowsRead: number;
  templateItemsSaved?: number;
  compositionsCreated?: number;
  compositionsLinked?: number;
  createdCompositions?: CreatedImportComposition[];
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
};

export type ImportApplyDecision = {
  rowKey: string;
  action: "map" | "create" | "ignore";
  targetCode?: string | null;
  targetItemId?: string | null;
  compositionId?: string | null;
  compositionName?: string | null;
  forceCreateComposition?: boolean;
};

export type MeasurementImportPreview = {
  rows: Array<{
    rowKey: string;
    sheet: string;
    rowNumber: number;
    code: string;
    quantity: number;
    description: string;
    unitRaw: string;
    unit: string;
    scope: string;
    unitPrice: number | null;
    action: "map" | "create" | "ignore";
    targetCode: string | null;
    targetItemId: string | null;
    targetDescription: string | null;
    matchMethod: "code" | "description" | "ai" | "none";
    confidence: number;
    note: string | null;
    compositionName: string | null;
    compositionId: string | null;
    priceSource: "file" | "composition" | "none";
    codeCollision?: boolean;
    needsReview?: boolean;
    willCreateComposition?: boolean;
  }>;
  catalog: Array<{
    code: string;
    description: string;
    unit: string;
    itemId: string | null;
    chapterCode: string;
    compositionName?: string | null;
    compositionId?: string | null;
  }>;
  compositionOptions?: Array<{ id: string; name: string; category: string | null; outputUnit: string }>;
  aiUsed: boolean;
  aiError: string | null;
  rowsRead: number;
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
