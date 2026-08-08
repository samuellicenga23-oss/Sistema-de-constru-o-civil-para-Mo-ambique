import { request } from "./http";
import type { MeasurementFormulaType } from "./measurementLines";

export type CertificateFieldLine = {
  id: string; certificateLineId: string; description: string; formulaType: MeasurementFormulaType; sign: 1 | -1;
  count: string; length: string | null; width: string | null; height: string | null; directQuantity: string | null;
  coefficient: string; unitWeight: string | null; diameterMm: string | null; baseQuantity: string | null; percentage: string | null;
  block: string | null; floor: string | null; zone: string | null; room: string | null; axis: string | null; element: string | null;
  evidenceUrls: string[]; notes: string | null; revisionNo: number; supersedesLineId: string | null; isActive: boolean; partial: number;
};
export type CertificateFieldInput = {
  description?: string; formulaType: MeasurementFormulaType; sign?: 1 | -1; count?: number | null; length?: number | null; width?: number | null; height?: number | null;
  directQuantity?: number | null; coefficient?: number; unitWeight?: number | null; diameterMm?: number | null; baseQuantity?: number | null; percentage?: number | null;
  block?: string | null; floor?: string | null; zone?: string | null; room?: string | null; axis?: string | null; element?: string | null;
  evidenceUrls?: string[]; notes?: string | null; overrunReason?: string | null; sortOrder?: number;
};
export const certificateFieldApi = {
  list: (certificateLineId: string, history = false) => request<CertificateFieldLine[]>(`/measurement-certificate-lines/${certificateLineId}/field-measurements${history ? "?history=true" : ""}`),
  create: (certificateLineId: string, data: CertificateFieldInput) => request<CertificateFieldLine>(`/measurement-certificate-lines/${certificateLineId}/field-measurements`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: CertificateFieldInput) => request<CertificateFieldLine>(`/measurement-certificate-field-lines/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ ok: true; periodQty: number }>(`/measurement-certificate-field-lines/${id}`, { method: "DELETE" }),
};
