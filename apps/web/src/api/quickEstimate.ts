import { request } from "./http";
import type { CalculationReportEntry } from "./boq";

export type RoomInput = { name: string; type: "seco" | "humido"; length: number; width: number };
export type FloorInput = { ceilingHeight: number; perimeter: number; rooms: RoomInput[] };
export type FoundationType = "sapata_isolada" | "sapata_corrida" | "laje";
export type RoofType = "laje_plana" | "chapa_metalica";

export type FootingDetail = { count: number; avgArea: number; avgDepth: number };

export type HydraulicInput = {
  toilets: number;
  sinks: number;
  showers: number;
  kitchenSinks: number;
  laundryTanks: number;
  hasWaterTank: boolean;
  manholeCount: number;
};

export type SoilType = "areia_grossa" | "areia_fina" | "argila_arenosa" | "argila_compacta";
export type SepticTankInput = {
  numberOfPeople: number;
  dailyFlowLPerPerson: number;
  soilType: SoilType;
};

export type QuickEstimateInput = {
  floors: FloorInput[];
  foundationType: FoundationType;
  footing?: FootingDetail;
  slabThickness?: number;
  concreteClass: "B20" | "B25" | "B30";
  roofType: RoofType;
  roofArea?: number;
  steelWeightKg?: number;
  beamConcreteVolumeM3?: number;
  floorSlabThicknessM?: number;
  columnConcreteVolumeM3?: number;
  formworkAreaM2?: number;
  backfillEarthVolumeM3?: number;
  sewerPipe110M?: number;
  sewerPipe40M?: number;
  downpipeLengthM?: number;
  waterSupplyPipeM?: number;
  hydraulic?: HydraulicInput;
  septicTank?: SepticTankInput;
  prices?: { cementBagPrice?: number; steelKgPrice?: number; blockUnitPrice?: number };
};

export type QuickEstimateResult = {
  itemsUpdated: number;
  report: CalculationReportEntry[];
  summary: {
    totalBuiltArea: number;
    groundFloorArea: number;
    roofArea: number;
    totalExteriorWallArea: number;
    totalInteriorWallArea: number;
    wetRoomsCount: number;
    concreteVolume: number;
    steelWeight: number;
    footingConcreteVolume: number;
    totalFixtures: number;
  };
};

export const quickEstimateApi = {
  apply: (documentId: string, input: QuickEstimateInput) =>
    request<QuickEstimateResult>(`/budget-documents/${documentId}/quick-estimate`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
