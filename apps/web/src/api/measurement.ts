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
  submittedByUserId: string | null;
  approvedByUserId: string | null;
  approvalNote: string | null;
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
  measuredQty?: number;
  proposedQty?: number | null;
  certifiedQty?: number | null;
  variationQty?: number;
  hasFieldMemory?: boolean;
  sectionId: string;
  sectionName: string;
};

export type MeasurementCertificateDetail = {
  certificate: MeasurementCertificate;
  lines: MeasurementLine[];
  financialParameters: {
    currency: string;
    ivaRate: number;
    contingenciasRate: number;
    siteCostsRate: number;
    indirectCostsRate: number;
    profitMarginRate: number;
  };
};

export type PhaseLabourLine = {
  labourCategoryId: string;
  name: string;
  plannedHours: number;
  periodHours: number;
  cumulativeHours: number;
  hourlyRate: number;
  periodCost: number;
  cumulativeCost: number;
  currency: string;
};

export type LabourByPhaseResponse = {
  currency: string;
  ivaRate: number;
  phases: Array<{
    key: string;
    label: string;
    labour: PhaseLabourLine[];
    itemsWithoutComposition: Array<{ code: string | null; description: string; periodQty: number; unit: string | null }>;
    periodHours: number;
    cumulativeHours: number;
    periodCost: number;
    cumulativeCost: number;
  }>;
  grandPeriodHours: number;
  grandCumulativeHours: number;
  grandPeriodCost: number;
  grandCumulativeCost: number;
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
  labourByPhase: (id: string) => request<LabourByPhaseResponse>(`/measurement-certificates/${id}/labour-by-phase`),
  fieldMeasurementsPdfUrl: (id: string) => `/api/measurement-certificates/${id}/field-measurements.pdf`,
  updateStatus: (id: string, status: "rascunho" | "submetido" | "aprovado", decisionNote?: string) =>
    request<MeasurementCertificate>(`/measurement-certificates/${id}`, { method: "PUT", body: JSON.stringify({ status, decisionNote }) }),
  delete: (id: string) => request<{ ok: true }>(`/measurement-certificates/${id}`, { method: "DELETE" }),
  updateLine: (lineId: string, data: { periodQty: number; notes?: string | null; overrunReason?: string | null }) =>
    request<unknown>(`/measurement-certificate-lines/${lineId}`, { method: "PUT", body: JSON.stringify(data) }),
  dashboard: (projectId: string, budgetDocumentId: string) =>
    request<MeasurementDashboard>(`/projects/${projectId}/measurement-dashboard?budgetDocumentId=${budgetDocumentId}`),
};
