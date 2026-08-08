import { request } from "./http";

export type MeasurementFormulaType =
  | "legacy_product" | "direct" | "count" | "length" | "area" | "wall_area" | "perimeter"
  | "volume" | "section_length" | "weight" | "reinforcement" | "percentage";
export type MeasurementSource = "manual" | "plant" | "import" | "bim" | "field";

export type MeasurementLine = {
  id: string;
  lineItemId: string;
  description: string;
  formulaType: MeasurementFormulaType;
  sign: 1 | -1;
  count: string;
  length: string | null;
  width: string | null;
  height: string | null;
  directQuantity: string | null;
  coefficient: string;
  unitWeight: string | null;
  diameterMm: string | null;
  baseQuantity: string | null;
  percentage: string | null;
  block: string | null;
  floor: string | null;
  zone: string | null;
  room: string | null;
  axis: string | null;
  element: string | null;
  source: MeasurementSource;
  sourceRef: string | null;
  revisionNo: number;
  supersedesLineId: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  sortOrder: number;
  partial: number;
  itemQuantity?: number | null;
};

export type MeasurementLineInput = {
  description?: string;
  formulaType?: MeasurementFormulaType;
  sign?: 1 | -1;
  count?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  directQuantity?: number | null;
  coefficient?: number;
  unitWeight?: number | null;
  diameterMm?: number | null;
  baseQuantity?: number | null;
  percentage?: number | null;
  block?: string | null;
  floor?: string | null;
  zone?: string | null;
  room?: string | null;
  axis?: string | null;
  element?: string | null;
  source?: MeasurementSource;
  sourceRef?: string | null;
  sortOrder?: number;
};

export type PlantMeasurementPreview = {
  ok: true;
  fingerprint: string;
  roomCount: number;
  strategy: string;
  lines: Array<MeasurementLineInput & { partial: number; expression: string }>;
};

export const measurementLinesApi = {
  list: (lineItemId: string) => request<MeasurementLine[]>(`/line-items/${lineItemId}/measurements`),
  history: (lineItemId: string) => request<MeasurementLine[]>(`/line-items/${lineItemId}/measurements/history`),
  create: (lineItemId: string, data: MeasurementLineInput) =>
    request<MeasurementLine>(`/line-items/${lineItemId}/measurements`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: MeasurementLineInput) =>
    request<MeasurementLine>(`/measurement-lines/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ ok: true; itemQuantity: number | null }>(`/measurement-lines/${id}`, { method: "DELETE" }),
  previewFromPlant: (lineItemId: string) => request<PlantMeasurementPreview>(`/line-items/${lineItemId}/measurement-preview/from-plant`),
  applyFromPlant: (lineItemId: string, data: { strategy: "replace" | "merge"; previewFingerprint: string; acceptedIndexes?: number[] }) =>
    request<{ linesApplied: number; strategy: string; itemQuantity: number | null; previewFingerprint: string }>(
      `/line-items/${lineItemId}/measurement-apply/from-plant`, { method: "POST", body: JSON.stringify(data) },
    ),
};
