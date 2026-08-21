import { request } from "./http";

export type InspectionTemplate = {
  id: string;
  trade: string;
  name: string;
  items: Array<{ key: string; label: string; required?: boolean }>;
};

export type QualityInspection = {
  id: string;
  projectId: string;
  trade: string;
  location: string | null;
  scheduleTaskId: string | null;
  inspectionDate: string;
  status: "rascunho" | "pass" | "fail" | "pendente";
  checklistResults: Array<{ key: string; pass: boolean; notes?: string }>;
  photoRefs: string[];
  notes: string | null;
  diaryEntryId: string | null;
};

export type HstRecord = {
  id: string;
  projectId: string;
  recordType: "toolbox_talk" | "incidente" | "observacao_risco" | "ppe_check";
  recordDate: string;
  location: string | null;
  description: string;
  photoRefs: string[];
  diaryEntryId: string | null;
};

export const fieldQualityApi = {
  listTemplates: () => request<{ templates: InspectionTemplate[] }>("/api/inspection-templates"),
  listInspections: (projectId: string) =>
    request<{ inspections: QualityInspection[] }>(`/api/projects/${projectId}/quality-inspections`),
  createInspection: (projectId: string, body: Record<string, unknown>) =>
    request<QualityInspection>(`/api/projects/${projectId}/quality-inspections`, { method: "POST", body: JSON.stringify(body) }),
  updateInspection: (id: string, body: Record<string, unknown>) =>
    request<QualityInspection>(`/api/quality-inspections/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  listHst: (projectId: string) => request<{ records: HstRecord[] }>(`/api/projects/${projectId}/hst-records`),
  createHst: (projectId: string, body: Record<string, unknown>) =>
    request<HstRecord>(`/api/projects/${projectId}/hst-records`, { method: "POST", body: JSON.stringify(body) }),
};
