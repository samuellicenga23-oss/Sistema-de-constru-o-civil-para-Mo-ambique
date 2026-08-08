import { request } from "./http";

export type ScheduleTaskStatus = "nao_iniciado" | "em_curso" | "bloqueado" | "concluido";
export type ScheduleDurationBasis = "produtividade" | "horas" | "valor" | "minimo" | "soma" | "manual";
export type ScheduleWeightBasis = "produtividade" | "horas" | "valor" | "minimo" | "manual" | "misto";
export type PlanningTrade = "earthworks" | "structure" | "masonry" | "mep" | "finishes" | "roofing" | "external";

export type ScheduleGenerationWarning = {
  code: string;
  message: string;
  sourceCode: string | null;
  activityName: string | null;
};

export type SchedulePlanningProfile = {
  schemaVersion: 1;
  startDate: string;
  locationStrategy: "boq" | "floors" | "floors_zones";
  floorLabels: string[];
  floorShares: number[] | null;
  zones: Array<{ id: string; label: string; share: number | null }>;
  sequencePolicy: "floor_by_floor" | "structure_complete_first";
  tradeFronts: Record<PlanningTrade, number | null>;
  crewSizes: Record<PlanningTrade, number | null>;
  cureLags: { foundations: number | null; columns: number | null; slabs: number | null };
  roofKindOverride: "sheet" | "slab" | null;
  targetDurationDays: number | null;
  notes: string | null;
};

export type SchedulePlanningContext = {
  floors: number;
  floorLabels: string[];
  configuredFloors?: number;
  floorSource?: "project" | "plant" | "combined";
  measuredItemCount: number;
  hasSigoTemplate: boolean;
  hasImportedScope: boolean;
  supportsFloorPlanning: boolean;
  detectedRoofKind: "sheet" | "slab" | "unknown";
  hasStructure: boolean;
  hasMasonry: boolean;
  hasMep: boolean;
  hasFinishes: boolean;
  hasRoof: boolean;
  hasExternal: boolean;
  activeTrades: PlanningTrade[];
  aggregatedFloorCodes: string[];
  aggregatedStructuralCodes: string[];
};

export type SchedulePlanningQuestion = {
  key: string;
  group: "organizacao" | "recursos" | "sequencia" | "prazo";
  label: string;
  help: string;
  required: boolean;
  kind: "choice" | "integer" | "floor_labels" | "shares" | "zones" | "trade_matrix" | "lags" | "notice";
  options?: Array<{ value: string; label: string }>;
};

export type SchedulePlanningSetup = {
  context: SchedulePlanningContext;
  questions: SchedulePlanningQuestion[];
  profile: SchedulePlanningProfile;
  status: "draft" | "previewed" | "generated" | string;
  previewFingerprint: string | null;
  previewedAt: string | null;
  generatedAt: string | null;
  validationErrors: string[];
  needsRegeneration: boolean;
  regenerationReasons: string[];
};

export type SchedulePlanningPreview = {
  valid: boolean;
  readyToGenerate: boolean;
  errors: string[];
  previewFingerprint: string | null;
  context: SchedulePlanningContext;
  profile: SchedulePlanningProfile;
  strategy: {
    floors: number;
    locationStrategy: SchedulePlanningProfile["locationStrategy"];
    sequencePolicy: SchedulePlanningProfile["sequencePolicy"];
    roofKind: "sheet" | "slab" | "unknown";
    activeTrades: PlanningTrade[];
    tradeFronts: Record<PlanningTrade, number | null>;
    crewSizes: Record<PlanningTrade, number | null>;
    cureLags: SchedulePlanningProfile["cureLags"];
    zones: SchedulePlanningProfile["zones"];
    physicalScope: { source: "plants" | "measurements" | "budget"; footings: number; slabs: number; rooms: number };
  };
  naturalDurationDays: number;
  targetDurationDays: number | null;
  plannedDurationDays: number;
  startDate: string;
  endDate: string;
  warnings: ScheduleGenerationWarning[];
  assumptions: string[];
  validation: {
    valueSharesValid: boolean;
    checkedBudgetItems: number;
    coverage: {
      measuredSourceLineItemCount: number;
      plannedSourceLineItemCount: number;
      missingSourceLineItemIds: string[];
      unexpectedSourceLineItemIds: string[];
    };
    dependencyCount: number;
    activityCount: number;
    durationBasis: { horas: number; valor: number; minimo: number };
    allocationBasis: { boq: number; informado: number; assumido: number };
    sampleActivities: Array<{
      code: string;
      name: string;
      durationDays: number;
      durationBasis: "horas" | "valor" | "minimo" | "soma";
      startDate: string;
      endDate: string;
      sourceCode: string | null;
      valueShare: number;
      allocationBasis: "boq" | "informado" | "assumido";
    }>;
  };
};

export type ScheduleTask = {
  id: string;
  projectId: string;
  parentId: string | null;
  budgetDocumentId: string | null;
  budgetLineItemId: string | null;
  code: string;
  name: string;
  budgetChapterCode: string | null;
  valueShare: string;
  startDate: string;
  endDate: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  durationDays: number;
  durationBasis: ScheduleDurationBasis;
  manualProgress: string | null;
  status: ScheduleTaskStatus;
  notes: string | null;
  sortOrder: number;
  progress: number;
  plannedValue: number;
  executedValue: number;
  progressSource: "autos" | "diario" | "manual" | "planeamento" | "subactividades";
  isSummary: boolean;
  isMilestone?: boolean;
  wbsDepth?: number;
  predecessorTaskId: string | null;
  predecessorTaskIds?: string[];
  dependencyCount?: number;
  dependencyType: "FS" | "SS" | "FF" | "SF" | null;
  lagDays: number;
};

export type ScheduleValidation = {
  valueSharesValid: boolean;
  checkedBudgetItems: number;
  valueShareIssues?: Array<{ budgetItem: string; totalShare: number }>;
  longActivities?: Array<{ id: string; code: string; name: string; durationDays: number }>;
  coverage?: {
    measuredSourceLineItemCount: number;
    plannedSourceLineItemCount: number;
    missingSourceLineItemIds: string[];
    unexpectedSourceLineItemIds: string[];
  };
};

export type ProjectSchedule = {
  tasks: ScheduleTask[];
  dependencies: Array<{ id: string; predecessorTaskId: string; successorTaskId: string; type: "FS" | "SS" | "FF" | "SF"; lagDays: number }>;
  startDate: string | null;
  endDate: string | null;
  overallProgress: number;
  plannedValue: number;
  executedValue: number;
  weightBasis: ScheduleWeightBasis;
  roofKind?: "sheet" | "slab" | "unknown";
  generationWarnings?: ScheduleGenerationWarning[];
  planningAssumptions?: string[];
  planningProfile?: SchedulePlanningProfile;
  validation: ScheduleValidation;
};

export type ScheduleTaskInput = Partial<{
  parentId: string | null;
  code: string;
  name: string;
  budgetDocumentId: string | null;
  budgetChapterCode: string | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  manualProgress: number | null;
  status: ScheduleTaskStatus;
  notes: string | null;
  predecessorTaskId: string | null;
  dependencyType: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
}>;

export type SchedulePaper = "auto" | "A3" | "A2" | "A1";
export type SchedulePrintScale = "fit" | 100 | 85 | 70 | 55;

export const scheduleApi = {
  get: (projectId: string) => request<ProjectSchedule>(`/projects/${projectId}/schedule`),
  planningSetup: (projectId: string, data: { budgetDocumentId: string; startDate: string }) =>
    request<SchedulePlanningSetup>(`/projects/${projectId}/schedule/planning/setup`, { method: "POST", body: JSON.stringify(data) }),
  savePlanningProfile: (projectId: string, data: { budgetDocumentId: string; profile: SchedulePlanningProfile }) =>
    request<{ profile: SchedulePlanningProfile; status: "draft" }>(`/projects/${projectId}/schedule/planning/profile`, { method: "PUT", body: JSON.stringify(data) }),
  previewPlanning: (projectId: string, data: { budgetDocumentId: string; startDate: string }) =>
    request<SchedulePlanningPreview>(`/projects/${projectId}/schedule/planning/preview`, { method: "POST", body: JSON.stringify(data) }),
  generate: (projectId: string, data: { budgetDocumentId: string; startDate: string; previewFingerprint: string }) =>
    request<ProjectSchedule>(`/projects/${projectId}/schedule/generate`, { method: "POST", body: JSON.stringify(data) }),
  createTask: (projectId: string, data: Required<Pick<ScheduleTaskInput, "code" | "name" | "startDate">> & ScheduleTaskInput) =>
    request<ScheduleTask>(`/projects/${projectId}/schedule/tasks`, { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: ScheduleTaskInput) => request<ScheduleTask>(`/schedule/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<{ ok: true }>(`/schedule/tasks/${id}`, { method: "DELETE" }),
  exportPdfUrl: (projectId: string, options: { paper: SchedulePaper; scale: SchedulePrintScale }) => {
    const query = new URLSearchParams({ paper: options.paper, scale: String(options.scale) });
    return `/api/projects/${projectId}/schedule/export.pdf?${query.toString()}`;
  },
};
