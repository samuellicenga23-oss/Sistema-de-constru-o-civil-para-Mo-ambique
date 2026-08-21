import { request } from "./http";

export type WorkforceWorker = { id: string; name: string; kind: string; trade: string | null };
export type WorkforceCrew = { id: string; name: string; trade: string | null };
export type WorkforceTimesheet = { id: string; workDate: string; hours: string; overtimeHours: string; status: string };
export type Subcontractor = { id: string; name: string; nuit: string | null; contractValue: string | null; retentionRate: string };

export const workforceApi = {
  inssRates: (projectId: string) => request<{ inssEmployer: { rate: number } | null; inssWorker: { rate: number } | null }>(`/api/projects/${projectId}/workforce/inss-rates`),
  listWorkers: (projectId: string) => request<{ workers: WorkforceWorker[] }>(`/api/projects/${projectId}/workforce/workers`),
  createWorker: (projectId: string, body: Record<string, unknown>) => request<WorkforceWorker>(`/api/projects/${projectId}/workforce/workers`, { method: "POST", body: JSON.stringify(body) }),
  listCrews: (projectId: string) => request<{ crews: WorkforceCrew[] }>(`/api/projects/${projectId}/workforce/crews`),
  createCrew: (projectId: string, body: Record<string, unknown>) => request<WorkforceCrew>(`/api/projects/${projectId}/workforce/crews`, { method: "POST", body: JSON.stringify(body) }),
  listTimesheets: (projectId: string) => request<{ timesheets: WorkforceTimesheet[] }>(`/api/projects/${projectId}/workforce/timesheets`),
  createTimesheet: (projectId: string, body: Record<string, unknown>) => request<WorkforceTimesheet>(`/api/projects/${projectId}/workforce/timesheets`, { method: "POST", body: JSON.stringify(body) }),
  listSubcontractors: (projectId: string) => request<{ subcontractors: Subcontractor[] }>(`/api/projects/${projectId}/subcontractors`),
  createSubcontractor: (projectId: string, body: Record<string, unknown>) => request<Subcontractor>(`/api/projects/${projectId}/subcontractors`, { method: "POST", body: JSON.stringify(body) }),
};
