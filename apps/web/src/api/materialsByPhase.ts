import { request } from "./http";

export type PhaseMaterialLine = {
  materialId: string;
  name: string;
  unit: string;
  quantity: number;
  value: number;
  currency: string;
  purchaseQty: number | null;
  purchasePackageLabel: string | null;
  purchasePackageQty: number | null;
};

export type SteelBarInfo = { diameterMm: number; lengthM: number; barLengthM: number; barsNeeded: number };

export type PhaseUnmappedItem = {
  code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  value: number;
  barsInfo: SteelBarInfo | null;
};

export type PhaseReport = {
  key: string;
  label: string;
  materials: PhaseMaterialLine[];
  itemsWithoutComposition: PhaseUnmappedItem[];
  valueTotal: number;
};

export type MaterialsByPhaseResponse = {
  document: { id: string; title: string };
  phases: PhaseReport[];
  currency: string;
  grandTotal: number;
};

export const materialsByPhaseApi = {
  get: (documentId: string) => request<MaterialsByPhaseResponse>(`/budget-documents/${documentId}/materials-by-phase`),
};
