import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  compositionDerivedCostLines,
  compositionSubcompositionLines,
  costCompositions,
  lineItemCostSnapshots,
} from "../db/schema.js";
import { computeCompositionUnitCostV2, getCompositionEffectiveResourcesV2 } from "./costEngineV2.js";

export type CostSnapshotReason = "attached" | "reprice" | "import" | "generated" | "revision_copy";
type Executor = any;

export async function createLineItemCostSnapshot(args: {
  lineItemId: string;
  compositionId: string;
  companyId: string | null;
  zoneId?: string | null;
  currency: "MZN" | "USD";
  reason: CostSnapshotReason;
}, executor: Executor = db) {
  const [composition] = await executor.select().from(costCompositions).where(eq(costCompositions.id, args.compositionId)).limit(1);
  if (!composition) throw new Error("Composição de custo não encontrada para snapshot");
  const breakdown = await computeCompositionUnitCostV2(args.compositionId, args.companyId, args.zoneId, executor);
  const effectiveResources = await getCompositionEffectiveResourcesV2(args.compositionId, args.companyId, args.zoneId, executor);
  const subcompositions = await executor.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, args.compositionId));
  const derived = await executor.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, args.compositionId));

  const resourceSnapshot = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    composition: {
      id: composition.id, code: composition.code, name: composition.name, version: composition.version,
      outputUnit: composition.outputUnit, crewSize: composition.crewSize,
      productiveHoursPerDay: composition.productiveHoursPerDay, outputPerDay: composition.outputPerDay,
      productivitySource: composition.productivitySource, defaultMeasurementFormula: composition.defaultMeasurementFormula,
    },
    labour: effectiveResources.labour,
    materials: effectiveResources.materials,
    equipment: effectiveResources.equipment,
    subcompositions: subcompositions.map((line: any) => ({ subcompositionId: line.subcompositionId, qtyPerUnit: Number(line.qtyPerUnit), notes: line.notes })),
    derivedCosts: derived.map((line: any) => ({ name: line.name, basis: line.basis, percentage: Number(line.percentage), notes: line.notes })),
    computed: {
      labourCost: breakdown.labourCost, materialCost: breakdown.materialCost, equipmentCost: breakdown.equipmentCost,
      subcompositionCost: breakdown.subcompositionCost, derivedCost: breakdown.derivedCost, unitCost: breakdown.unitCost,
      productivity: breakdown.productivity,
    },
  };

  const [snapshot] = await executor.insert(lineItemCostSnapshots).values({
    lineItemId: args.lineItemId,
    compositionId: args.compositionId,
    compositionVersion: composition.version,
    zoneId: args.zoneId ?? null,
    currency: args.currency,
    unitCost: breakdown.unitCost.toFixed(4),
    labourCost: breakdown.labourCost.toFixed(4),
    materialCost: breakdown.materialCost.toFixed(4),
    equipmentCost: breakdown.equipmentCost.toFixed(4),
    subcompositionCost: breakdown.subcompositionCost.toFixed(4),
    derivedCost: breakdown.derivedCost.toFixed(4),
    resourceSnapshot,
    reason: args.reason,
  }).returning();
  return snapshot;
}

/**
 * Uma revisão de orçamento herda o snapshot histórico do item original; não recalcula a APU
 * com preços actuais, pois isso faria uma mera cópia alterar a base contratual sem pedido de reprice.
 */
export async function copyLatestLineItemCostSnapshot(args: {
  sourceLineItemId: string;
  targetLineItemId: string;
  reason?: CostSnapshotReason;
}, executor: Executor = db) {
  const [source] = await executor.select().from(lineItemCostSnapshots)
    .where(eq(lineItemCostSnapshots.lineItemId, args.sourceLineItemId))
    .orderBy(desc(lineItemCostSnapshots.createdAt)).limit(1);
  if (!source) return null;
  const { id: _id, lineItemId: _lineItemId, createdAt: _createdAt, ...rest } = source;
  const [copy] = await executor.insert(lineItemCostSnapshots).values({
    ...rest,
    lineItemId: args.targetLineItemId,
    reason: args.reason ?? "revision_copy",
  }).returning();
  return copy;
}
