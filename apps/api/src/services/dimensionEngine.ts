import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementLines, lineItems } from "../db/schema.js";
import { calculateMeasurementPartial, roundMeasurement, type MeasurementFormulaType } from "./measurementFormulaEngine.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function computePartial(line: {
  formulaType?: string | null;
  sign?: number | null;
  count: string | number;
  length: string | number | null;
  width: string | number | null;
  height: string | number | null;
  directQuantity?: string | number | null;
  coefficient?: string | number | null;
  unitWeight?: string | number | null;
  diameterMm?: string | number | null;
  baseQuantity?: string | number | null;
  percentage?: string | number | null;
}): number {
  const calculation = calculateMeasurementPartial({
    formulaType: (line.formulaType ?? "legacy_product") as MeasurementFormulaType,
    sign: Number(line.sign ?? 1),
    count: Number(line.count),
    length: line.length == null ? null : Number(line.length),
    width: line.width == null ? null : Number(line.width),
    height: line.height == null ? null : Number(line.height),
    directQuantity: line.directQuantity == null ? null : Number(line.directQuantity),
    coefficient: line.coefficient == null ? 1 : Number(line.coefficient),
    unitWeight: line.unitWeight == null ? null : Number(line.unitWeight),
    diameterMm: line.diameterMm == null ? null : Number(line.diameterMm),
    baseQuantity: line.baseQuantity == null ? null : Number(line.baseQuantity),
    percentage: line.percentage == null ? null : Number(line.percentage),
  });
  return calculation.partial;
}

export async function getMeasurementLines(lineItemId: string, dbOrTx: Tx | typeof db = db) {
  const rows = await dbOrTx
    .select()
    .from(measurementLines)
    .where(and(eq(measurementLines.lineItemId, lineItemId), eq(measurementLines.isActive, true)))
    .orderBy(measurementLines.sortOrder, measurementLines.createdAt);
  return rows.map((row) => ({ ...row, partial: computePartial(row) }));
}

/**
 * A quantidade do item passa a ter uma única verdade: soma das linhas activas da memória.
 * Quando a última linha é removida, o valor anterior NÃO permanece órfão — fica null.
 * Cálculo interno usa 6 casas; line_items guarda 4, coerente com o schema do BOQ.
 */
export function quantityFromMeasurementPartials(partials: number[]): number | null {
  if (partials.length === 0) return null;
  return roundMeasurement(partials.reduce((sum, line) => sum + line, 0), 6);
}

export async function recomputeItemQuantity(lineItemId: string, dbOrTx: Tx | typeof db = db): Promise<number | null> {
  const lines = await getMeasurementLines(lineItemId, dbOrTx);
  const total = quantityFromMeasurementPartials(lines.map((line) => line.partial));
  if (total == null) {
    await dbOrTx.update(lineItems).set({ quantity: null, quantitySource: "manual" }).where(eq(lineItems.id, lineItemId));
    return null;
  }
  const sources = new Set(lines.map((line) => line.source));
  const quantitySource = sources.size === 1
    ? ({ plant: "plant", import: "import", bim: "bim", manual: "measurement", field: "measurement" } as const)[lines[0].source]
    : "measurement";
  await dbOrTx.update(lineItems).set({ quantity: total.toFixed(4), quantitySource }).where(eq(lineItems.id, lineItemId));
  return total;
}
