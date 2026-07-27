import { request } from "./http";

export type MeasurementCertificate = {
  id: string;
  projectId: string;
  budgetDocumentId: string;
  number: number;
  periodStartDate: string | null;
  periodDate: string;
  status: "rascunho" | "submetido" | "aprovado";
  notes: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
};

export type MeasurementLine = {
  id: string;
  lineItemId: string;
  code: string | null;
  description: string;
  unit: string | null;
  budgetedQty: number | null;
  unitPrice: number;
  previousQty: number;
  cumulativeQty: number;
  periodQty: number;
  periodValue: number;
  cumulativeValue: number;
  percentExecuted: number | null;
  remainingQty: number | null;
  notes: string | null;
  overrunReason: string | null;
  hasOverrun: boolean;
  sectionId: string;
  sectionName: string;
};

export type MeasurementCertificateDetail = {
  certificate: MeasurementCertificate;
  lines: MeasurementLine[];
};

export type MeasurementDashboard =
  | { hasCertificates: false }
  | {
      hasCertificates: true;
      latestCertificateNumber: number;
      previstoTotal: number;
      executadoTotal: number;
      percentExecutado: number;
      linhas: MeasurementLine[];
    };

export const measurementApi = {
  list: (projectId: string) => request<MeasurementCertificate[]>(`/projects/${projectId}/measurement-certificates`),
  create: (projectId: string, data: { budgetDocumentId: string; periodStartDate?: string; periodDate: string; notes?: string }) =>
    request<MeasurementCertificate>(`/projects/${projectId}/measurement-certificates`, { method: "POST", body: JSON.stringify(data) }),
  detail: (id: string) => request<MeasurementCertificateDetail>(`/measurement-certificates/${id}`),
  updateStatus: (id: string, status: "rascunho" | "submetido" | "aprovado", decisionNote?: string) =>
    request<MeasurementCertificate>(`/measurement-certificates/${id}`, { method: "PUT", body: JSON.stringify({ status, decisionNote }) }),
  delete: (id: string) => request<{ ok: true }>(`/measurement-certificates/${id}`, { method: "DELETE" }),
  updateLine: (lineId: string, data: { periodQty: number; notes?: string | null; overrunReason?: string | null }) =>
    request<unknown>(`/measurement-certificate-lines/${lineId}`, { method: "PUT", body: JSON.stringify(data) }),
  dashboard: (projectId: string, budgetDocumentId: string) =>
    request<MeasurementDashboard>(`/projects/${projectId}/measurement-dashboard?budgetDocumentId=${budgetDocumentId}`),
};
