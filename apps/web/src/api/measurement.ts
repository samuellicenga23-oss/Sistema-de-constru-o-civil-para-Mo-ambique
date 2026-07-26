import { request } from "./http";

export type MeasurementCertificate = {
  id: string;
  projectId: string;
  budgetDocumentId: string;
  number: number;
  periodDate: string;
  status: "rascunho" | "submetido" | "aprovado";
};

export type MeasurementLine = {
  id: string;
  lineItemId: string;
  code: string | null;
  description: string;
  unit: string | null;
  budgetedQty: number | null;
  unitPrice: number;
  cumulativeQty: number;
  periodQty: number;
  periodValue: number;
  cumulativeValue: number;
  percentExecuted: number | null;
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
  create: (projectId: string, data: { budgetDocumentId: string; periodDate: string }) =>
    request<MeasurementCertificate>(`/projects/${projectId}/measurement-certificates`, { method: "POST", body: JSON.stringify(data) }),
  detail: (id: string) => request<MeasurementCertificateDetail>(`/measurement-certificates/${id}`),
  updateStatus: (id: string, status: "rascunho" | "submetido" | "aprovado") =>
    request<MeasurementCertificate>(`/measurement-certificates/${id}`, { method: "PUT", body: JSON.stringify({ status }) }),
  delete: (id: string) => request<{ ok: true }>(`/measurement-certificates/${id}`, { method: "DELETE" }),
  updateLine: (lineId: string, cumulativeQty: number) =>
    request<unknown>(`/measurement-certificate-lines/${lineId}`, { method: "PUT", body: JSON.stringify({ cumulativeQty }) }),
  dashboard: (projectId: string, budgetDocumentId: string) =>
    request<MeasurementDashboard>(`/projects/${projectId}/measurement-dashboard?budgetDocumentId=${budgetDocumentId}`),
};
