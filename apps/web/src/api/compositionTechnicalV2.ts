import { request } from "./http";

export type MeasurementFormulaType =
  | "legacy_product" | "direct" | "count" | "length" | "area" | "wall_area" | "perimeter"
  | "volume" | "section_length" | "weight" | "reinforcement" | "percentage";

export type SubcompositionLineV2 = {
  id?: string;
  refId: string;
  qtyPerUnit: string | number;
  notes?: string | null;
  name?: string;
  outputUnit?: string;
};

export type DerivedCostLineV2 = {
  id?: string;
  name: string;
  basis: "materials" | "labour" | "equipment" | "subcompositions" | "direct";
  percentage: string | number;
  notes?: string | null;
};

export type CompositionTechnicalV2Detail = {
  id: string;
  crewSize: number | null;
  productiveHoursPerDay: string | null;
  outputPerDay: string | null;
  productivitySource: string | null;
  productivityNotes: string | null;
  defaultMeasurementFormula: MeasurementFormulaType | null;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  subcompositionCost: number;
  derivedCost: number;
  directCost: number;
  unitCost: number;
  derivedOutputPerDay: number | null;
  productivityBasis: string | null;
  subcompositionLines: SubcompositionLineV2[];
  derivedCostLines: DerivedCostLineV2[];
};

export type CompositionTechnicalV2Input = {
  crewSize?: number | null;
  productiveHoursPerDay?: number | null;
  outputPerDay?: number | null;
  productivitySource?: string | null;
  productivityNotes?: string | null;
  defaultMeasurementFormula?: MeasurementFormulaType | null;
  subcompositionLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
  derivedCostLines: Array<{ name: string; basis: DerivedCostLineV2["basis"]; percentage: number; notes?: string | null }>;
};

export const compositionTechnicalV2Api = {
  get: (id: string) => request<CompositionTechnicalV2Detail>(`/catalog/compositions/${id}`),
  update: (id: string, data: CompositionTechnicalV2Input) =>
    request<CompositionTechnicalV2Detail>(`/catalog/compositions/${id}/technical-v2`, { method: "PUT", body: JSON.stringify(data) }),
};
