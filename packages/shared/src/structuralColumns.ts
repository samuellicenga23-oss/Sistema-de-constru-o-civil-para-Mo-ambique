import { z } from "zod";
import { rebarWeightPerMeter } from "./rebar.js";
import { roundToSigoPrecision } from "./precision.js";

export const structuralFloorSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(100),
  sortOrder: z.number().int(),
  elevationM: z.number().nullable().optional().default(null),
  floorToFloorHeightM: z.number().positive().max(20).nullable().optional().default(null),
  slabThicknessM: z.number().nonnegative().max(2).nullable().optional().default(null),
  source: z.enum(["plant", "manual"]).default("plant"),
});
export type StructuralFloor = z.infer<typeof structuralFloorSchema>;

export const structuralColumnGroupSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1).max(160),
  designation: z.string().max(160).optional(),
  shape: z.enum(["rectangular", "circular", "custom"]).default("rectangular"),
  widthCm: z.number().nonnegative().max(500).nullable().optional().default(null),
  depthCm: z.number().nonnegative().max(500).nullable().optional().default(null),
  diameterCm: z.number().nonnegative().max(500).nullable().optional().default(null),
  quantity: z.number().int().nonnegative(),
  fromFloor: z.string().max(100).nullable().optional().default(null),
  toFloor: z.string().max(100).nullable().optional().default(null),
  explicitHeightM: z.number().nonnegative().max(50).nullable().optional().default(null),
  longitudinalBarCount: z.number().int().nonnegative().max(64).nullable().optional().default(null),
  longitudinalDiameterMm: z.number().nonnegative().max(50).nullable().optional().default(null),
  stirrupDiameterMm: z.number().nonnegative().max(32).nullable().optional().default(null),
  stirrupSpacingCm: z.number().nonnegative().max(80).nullable().optional().default(null),
  concreteVolumeM3: z.number().nonnegative().default(0),
  steelWeightKg: z.number().nonnegative().default(0),
  steelSource: z.enum(["map", "calculated", "estimate", "manual"]).default("calculated"),
  sourcePage: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  needsConfirmation: z.boolean().default(true),
});
export type StructuralColumnGroup = z.infer<typeof structuralColumnGroupSchema>;

export type ColumnHeightResolution = {
  heightM: number | null;
  basis: "explicit" | "elevations" | "floorToFloorHeight" | "missing";
};

export function resolveColumnHeightM(
  group: Pick<StructuralColumnGroup, "explicitHeightM" | "fromFloor" | "toFloor">,
  floors: StructuralFloor[],
): ColumnHeightResolution {
  if (group.explicitHeightM != null && group.explicitHeightM > 0) {
    return { heightM: roundToSigoPrecision(group.explicitHeightM), basis: "explicit" };
  }
  const from = floors.find((floor) => floor.label === group.fromFloor);
  const to = floors.find((floor) => floor.label === group.toFloor);
  if (from?.elevationM != null && to?.elevationM != null && from.elevationM !== to.elevationM) {
    return { heightM: roundToSigoPrecision(Math.abs(to.elevationM - from.elevationM)), basis: "elevations" };
  }
  const host = from ?? to ?? floors.find((floor) => floor.label === group.fromFloor || floor.label === group.toFloor);
  if (host?.floorToFloorHeightM != null && host.floorToFloorHeightM > 0) {
    return { heightM: roundToSigoPrecision(host.floorToFloorHeightM), basis: "floorToFloorHeight" };
  }
  return { heightM: null, basis: "missing" };
}

export function columnConcreteVolumeM3(
  group: Pick<StructuralColumnGroup, "shape" | "widthCm" | "depthCm" | "diameterCm" | "quantity">,
  heightM: number | null,
): number {
  if (heightM == null || heightM <= 0 || group.quantity <= 0) return 0;
  if (group.shape === "circular" && group.diameterCm != null && group.diameterCm > 0) {
    const diameterM = group.diameterCm / 100;
    return roundToSigoPrecision(group.quantity * Math.PI * diameterM * diameterM * 0.25 * heightM);
  }
  if (group.widthCm != null && group.widthCm > 0 && group.depthCm != null && group.depthCm > 0) {
    return roundToSigoPrecision(group.quantity * (group.widthCm / 100) * (group.depthCm / 100) * heightM);
  }
  return 0;
}

export function columnSteelWeightKg(
  group: Pick<StructuralColumnGroup, "quantity" | "longitudinalBarCount" | "longitudinalDiameterMm" | "stirrupDiameterMm" | "stirrupSpacingCm" | "widthCm" | "depthCm" | "diameterCm" | "shape">,
  heightM: number | null,
): number {
  if (heightM == null || heightM <= 0 || group.quantity <= 0) return 0;
  const bars = group.longitudinalBarCount ?? 0;
  const diameter = group.longitudinalDiameterMm ?? 0;
  if (!(bars > 0 && diameter > 0)) return 0;
  const longitudinal = group.quantity * bars * heightM * 1.1 * rebarWeightPerMeter(diameter);
  let stirrups = 0;
  const stirrupDiameter = group.stirrupDiameterMm ?? 0;
  const spacingM = (group.stirrupSpacingCm ?? 0) / 100;
  if (stirrupDiameter > 0 && spacingM > 0) {
    const perimeterM = group.shape === "circular" && group.diameterCm
      ? Math.PI * (group.diameterCm / 100)
      : 2 * ((group.widthCm ?? 0) + (group.depthCm ?? 0)) / 100;
    if (perimeterM > 0) {
      stirrups = group.quantity * Math.ceil(heightM / spacingM) * perimeterM * rebarWeightPerMeter(stirrupDiameter);
    }
  }
  return roundToSigoPrecision(longitudinal + stirrups);
}

export function finalizeColumnGroup(
  group: StructuralColumnGroup,
  floors: StructuralFloor[],
): StructuralColumnGroup {
  const { heightM, basis } = resolveColumnHeightM(group, floors);
  const concreteVolumeM3 = columnConcreteVolumeM3(group, heightM);
  let steelWeightKg = group.steelWeightKg;
  let steelSource = group.steelSource;
  if (steelSource === "map" || steelSource === "manual") {
    steelWeightKg = roundToSigoPrecision(group.steelWeightKg);
  } else {
    const calculated = columnSteelWeightKg(group, heightM);
    if (calculated > 0) {
      steelWeightKg = calculated;
      steelSource = "calculated";
    } else {
      steelWeightKg = 0;
      steelSource = "calculated";
    }
  }
  const needsConfirmation = basis === "missing" || concreteVolumeM3 <= 0 || group.quantity <= 0;
  const confidence = needsConfirmation ? Math.min(group.confidence ?? 0.5, 0.45) : Math.max(group.confidence ?? 0.5, 0.75);
  return {
    ...group,
    explicitHeightM: group.explicitHeightM ?? (basis === "explicit" ? heightM : group.explicitHeightM),
    concreteVolumeM3,
    steelWeightKg,
    steelSource,
    needsConfirmation,
    confidence,
  };
}

export function syncColumnAggregatesFromGroups(groups: StructuralColumnGroup[]): {
  columnsCount: number;
  columnsConcreteVolumeM3: number;
  columnsCalculatedSteelWeightKg: number;
} {
  return {
    columnsCount: groups.reduce((sum, group) => sum + group.quantity, 0),
    columnsConcreteVolumeM3: roundToSigoPrecision(groups.reduce((sum, group) => sum + group.concreteVolumeM3, 0)),
    columnsCalculatedSteelWeightKg: roundToSigoPrecision(groups.reduce((sum, group) => sum + group.steelWeightKg, 0)),
  };
}
