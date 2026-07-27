import { request } from "./http";

export type ScheduleTaskStatus = "nao_iniciado" | "em_curso" | "bloqueado" | "concluido";
export type ScheduleTask = {
  id: string;
  projectId: string;
  parentId: string | null;
  budgetDocumentId: string | null;
  code: string;
  name: string;
  budgetChapterCode: string | null;
  startDate: string;
  endDate: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  durationDays: number;
  manualProgress: string | null;
  status: ScheduleTaskStatus;
  notes: string | null;
  sortOrder: number;
  progress: number;
  plannedValue: number;
  executedValue: number;
  progressSource: "autos" | "diario" | "manual" | "planeamento" | "subactividades";
  isSummary: boolean;
  predecessorTaskId: string | null;
  dependencyType: "FS" | "SS" | "FF" | "SF" | null;
  lagDays: number;
};

export type ProjectSchedule = {
  tasks: ScheduleTask[];
  dependencies: Array<{ id: string; predecessorTaskId: string; successorTaskId: string; type: "FS" | "SS" | "FF" | "SF"; lagDays: number }>;
  startDate: string | null;
  endDate: string | null;
  overallProgress: number;
  plannedValue: number;
  executedValue: number;
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

export const scheduleApi = {
  get: (projectId: string) => request<ProjectSchedule>(`/projects/${projectId}/schedule`),
  generate: (projectId: string, data: { budgetDocumentId: string; startDate: string; totalDurationDays: number }) =>
    request<ProjectSchedule>(`/projects/${projectId}/schedule/generate`, { method: "POST", body: JSON.stringify(data) }),
  createTask: (projectId: string, data: Required<Pick<ScheduleTaskInput, "code" | "name" | "startDate">> & ScheduleTaskInput) =>
    request<ScheduleTask>(`/projects/${projectId}/schedule/tasks`, { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: ScheduleTaskInput) => request<ScheduleTask>(`/schedule/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<{ ok: true }>(`/schedule/tasks/${id}`, { method: "DELETE" }),
  exportPdfUrl: (projectId: string) => `/api/projects/${projectId}/schedule/export.pdf`,
};
