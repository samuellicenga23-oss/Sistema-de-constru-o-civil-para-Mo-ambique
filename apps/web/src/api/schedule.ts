import { request } from "./http";

export type ScheduleTaskStatus = "nao_iniciado" | "em_curso" | "bloqueado" | "concluido";
export type ScheduleDurationBasis = "horas" | "valor" | "minimo" | "soma" | "manual";
export type ScheduleWeightBasis = "horas" | "valor" | "minimo" | "manual" | "misto";

export type ScheduleGenerationWarning = {
  code: string;
  message: string;
  sourceCode: string | null;
  activityName: string | null;
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
  crewSizePerFront?: number;
  valueShareIssues?: Array<{ budgetItem: string; totalShare: number }>;
  longActivities?: Array<{ id: string; code: string; name: string; durationDays: number }>;
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
  generate: (projectId: string, data: { budgetDocumentId: string; startDate: string; totalDurationDays?: number; maxCrewSize?: number }) =>
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
