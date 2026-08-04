// Comprimento comercial usado pelos fornecedores locais em Moçambique.
export const DEFAULT_REBAR_LENGTH_M = 5.75;

/** Emendas / sobreposições típicas em lajes (sobre o aço líquido da malha). */
export const DEFAULT_SLAB_LAP_FACTOR = 1.1;

export type RebarWeightLine = { diameterMm: number; weightKg: number };

export type RebarPurchaseLine = {
  diameterMm: number;
  scheduledWeightKg: number;
  weightPerMeterKg: number;
  requiredLengthM: number;
  commercialBarLengthM: number;
  barsToBuy: number;
  purchaseWeightKg: number;
  cuttingSurplusKg: number;
};

export type SlabMeshDirection = {
  diameterMm: number;
  spacingCm: number;
  role: string;
};

export type SlabRebarLayerInput = {
  label: string;
  directions: SlabMeshDirection[];
};

export type SlabMeshWeightLine = RebarWeightLine & {
  role: string;
  layer: string;
};

export function rebarWeightPerMeter(diameterMm: number): number {
  const diameterM = diameterMm / 1000;
  return (Math.PI / 4) * diameterM * diameterM * 7850;
}

/** kg/m² de uma direcção de malha: (kg/m) ÷ espaçamento (m). */
export function meshWeightKgPerM2(diameterMm: number, spacingCm: number): number {
  if (!(diameterMm > 0) || !(spacingCm > 0)) return 0;
  return rebarWeightPerMeter(diameterMm) / (spacingCm / 100);
}

/**
 * Calcula aço líquido por camada e direcção numa laje.
 * `lapFactor` (ex. 1.10) aplica emendas/sobreposições sobre o líquido da malha.
 */
export function computeSlabRebarWeightLines(input: {
  areaM2: number;
  layers: SlabRebarLayerInput[];
  lapFactor?: number;
}): SlabMeshWeightLine[] {
  const area = input.areaM2;
  const lap = input.lapFactor ?? 1;
  if (!(area > 0) || !(lap > 0)) return [];

  const lines: SlabMeshWeightLine[] = [];
  for (const layer of input.layers) {
    for (const dir of layer.directions) {
      const meshKg = area * meshWeightKgPerM2(dir.diameterMm, dir.spacingCm);
      if (!(meshKg > 0)) continue;
      lines.push({
        diameterMm: dir.diameterMm,
        weightKg: meshKg * lap,
        role: dir.role,
        layer: layer.label,
      });
    }
  }
  return lines;
}

export function buildRebarPurchasePlan(
  lines: RebarWeightLine[],
  commercialBarLengthM = DEFAULT_REBAR_LENGTH_M,
): RebarPurchaseLine[] {
  const totals = new Map<number, number>();
  for (const line of lines) {
    if (!(line.diameterMm > 0) || !(line.weightKg > 0)) continue;
    totals.set(line.diameterMm, (totals.get(line.diameterMm) ?? 0) + line.weightKg);
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => a - b)
    .map(([diameterMm, scheduledWeightKg]) => {
      const weightPerMeterKg = rebarWeightPerMeter(diameterMm);
      const requiredLengthM = scheduledWeightKg / weightPerMeterKg;
      const barsToBuy = Math.ceil(requiredLengthM / commercialBarLengthM);
      const purchaseWeightKg = barsToBuy * commercialBarLengthM * weightPerMeterKg;
      return {
        diameterMm,
        scheduledWeightKg,
        weightPerMeterKg,
        requiredLengthM,
        commercialBarLengthM,
        barsToBuy,
        purchaseWeightKg,
        cuttingSurplusKg: Math.max(0, purchaseWeightKg - scheduledWeightKg),
      };
    });
}
