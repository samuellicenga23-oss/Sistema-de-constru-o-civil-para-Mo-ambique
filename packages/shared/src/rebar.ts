export const DEFAULT_REBAR_LENGTH_M = 12;

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

export function rebarWeightPerMeter(diameterMm: number): number {
  const diameterM = diameterMm / 1000;
  return (Math.PI / 4) * diameterM * diameterM * 7850;
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
