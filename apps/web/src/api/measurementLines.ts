import { request } from "./http";

export type MeasurementLine = {
  id: string;
  lineItemId: string;
  description: string;
  count: string;
  length: string | null;
  width: string | null;
  height: string | null;
  sortOrder: number;
  partial: number;
  itemQuantity?: number | null;
};

export type MeasurementLineInput = {
  description?: string;
  count?: number;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
};

export const measurementLinesApi = {
  list: (lineItemId: string) => request<MeasurementLine[]>(`/line-items/${lineItemId}/measurements`),
  create: (lineItemId: string, data: MeasurementLineInput) =>
    request<MeasurementLine>(`/line-items/${lineItemId}/measurements`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: MeasurementLineInput) =>
    request<MeasurementLine>(`/measurement-lines/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ ok: true; itemQuantity: number | null }>(`/measurement-lines/${id}`, { method: "DELETE" }),
};
