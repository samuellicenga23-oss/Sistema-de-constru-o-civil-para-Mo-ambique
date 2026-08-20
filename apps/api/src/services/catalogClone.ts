import { eq, isNull, and, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  labourCategories,
  materials,
  equipment,
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
  compositionSubcompositionLines,
  compositionDerivedCostLines,
} from "../db/schema.js";

export async function cloneLabourCategoryForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(labourCategories).where(and(eq(labourCategories.id, sourceId), isNull(labourCategories.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db.insert(labourCategories).values({
    companyId, familyKey: source.familyKey, code: source.code, name: source.name, monthlySalary: source.monthlySalary,
    productiveHoursPerMonth: source.productiveHoursPerMonth, socialChargesPct: source.socialChargesPct,
    complementaryCostsPct: source.complementaryCostsPct, hourlyRate: source.hourlyRate, currency: source.currency,
    sourceName: source.sourceName, sourceReference: source.sourceReference, effectiveDate: source.effectiveDate, isActive: source.isActive,
  }).returning();
  return copy;
}

export async function cloneMaterialForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(materials).where(and(eq(materials.id, sourceId), isNull(materials.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db.insert(materials).values({
    companyId, familyKey: source.familyKey, code: source.code, name: source.name, category: source.category, specification: source.specification,
    unit: source.unit, baseUnitCost: source.baseUnitCost, importFactor: source.importFactor, defaultWastePct: source.defaultWastePct,
    currency: source.currency, priceSourceName: source.priceSourceName, sourceReference: source.sourceReference, priceDate: source.priceDate,
    includesVat: source.includesVat, isActive: source.isActive, purchasePackageLabel: source.purchasePackageLabel, purchasePackageQty: source.purchasePackageQty,
  }).returning();
  return copy;
}

export async function cloneEquipmentForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(equipment).where(and(eq(equipment.id, sourceId), isNull(equipment.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db.insert(equipment).values({
    companyId, familyKey: source.familyKey, name: source.name, unit: source.unit, hourlyCost: source.hourlyCost, currency: source.currency,
  }).returning();
  return copy;
}

export async function setMaterialPriceByName(companyId: string, name: string, baseUnitCost: number): Promise<boolean> {
  const [own] = await db.select().from(materials).where(and(eq(materials.name, name), eq(materials.companyId, companyId))).limit(1);
  if (own) { await db.update(materials).set({ baseUnitCost: baseUnitCost.toString() }).where(eq(materials.id, own.id)); return true; }
  const [global] = await db.select().from(materials).where(and(eq(materials.name, name), isNull(materials.companyId))).limit(1);
  if (!global) return false;
  const clone = await cloneMaterialForCompany(global.id, companyId);
  if (!clone) return false;
  await db.update(materials).set({ baseUnitCost: baseUnitCost.toString() }).where(eq(materials.id, clone.id));
  return true;
}

export async function cloneCompositionForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(costCompositions).where(and(eq(costCompositions.id, sourceId), isNull(costCompositions.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db.insert(costCompositions).values({
    companyId, code: source.code, name: source.name, category: source.category, description: source.description,
    measurementCriteria: source.measurementCriteria, executionNotes: source.executionNotes, outputUnit: source.outputUnit, currency: source.currency,
    auxiliaryCostPct: source.auxiliaryCostPct, indirectCostPct: source.indirectCostPct, profitMarginPct: source.profitMarginPct,
    version: 1, sourceName: source.sourceName, sourceReference: source.sourceReference, isActive: source.isActive,
    crewSize: source.crewSize, productiveHoursPerDay: source.productiveHoursPerDay, outputPerDay: source.outputPerDay,
    productivitySource: source.productivitySource, productivityNotes: source.productivityNotes,
    defaultMeasurementFormula: source.defaultMeasurementFormula,
    visibility: "company",
    parentCompositionId: source.id,
    ownerUserId: null,
  }).returning();

  const [labourLines, materialLines, equipmentLines, subcompositionLines, derivedLines] = await Promise.all([
    db.select().from(compositionLabourLines).where(eq(compositionLabourLines.compositionId, sourceId)),
    db.select().from(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, sourceId)),
    db.select().from(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, sourceId)),
    db.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, sourceId)),
    db.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, sourceId)),
  ]);
  if (labourLines.length) await db.insert(compositionLabourLines).values(labourLines.map((line) => ({ compositionId: copy.id, labourCategoryId: line.labourCategoryId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (materialLines.length) await db.insert(compositionMaterialLines).values(materialLines.map((line) => ({ compositionId: copy.id, materialId: line.materialId, qtyPerUnit: line.qtyPerUnit, wastePct: line.wastePct, notes: line.notes })));
  if (equipmentLines.length) await db.insert(compositionEquipmentLines).values(equipmentLines.map((line) => ({ compositionId: copy.id, equipmentId: line.equipmentId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (subcompositionLines.length) await db.insert(compositionSubcompositionLines).values(subcompositionLines.map((line) => ({ compositionId: copy.id, subcompositionId: line.subcompositionId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (derivedLines.length) await db.insert(compositionDerivedCostLines).values(derivedLines.map((line) => ({ compositionId: copy.id, name: line.name, basis: line.basis, percentage: line.percentage, notes: line.notes })));
  return copy;
}

async function copyCompositionLines(sourceId: string, targetId: string) {
  const [labourLines, materialLines, equipmentLines, subcompositionLines, derivedLines] = await Promise.all([
    db.select().from(compositionLabourLines).where(eq(compositionLabourLines.compositionId, sourceId)),
    db.select().from(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, sourceId)),
    db.select().from(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, sourceId)),
    db.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, sourceId)),
    db.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, sourceId)),
  ]);
  if (labourLines.length) await db.insert(compositionLabourLines).values(labourLines.map((line) => ({ compositionId: targetId, labourCategoryId: line.labourCategoryId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (materialLines.length) await db.insert(compositionMaterialLines).values(materialLines.map((line) => ({ compositionId: targetId, materialId: line.materialId, qtyPerUnit: line.qtyPerUnit, wastePct: line.wastePct, notes: line.notes })));
  if (equipmentLines.length) await db.insert(compositionEquipmentLines).values(equipmentLines.map((line) => ({ compositionId: targetId, equipmentId: line.equipmentId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (subcompositionLines.length) await db.insert(compositionSubcompositionLines).values(subcompositionLines.map((line) => ({ compositionId: targetId, subcompositionId: line.subcompositionId, qtyPerUnit: line.qtyPerUnit, notes: line.notes })));
  if (derivedLines.length) await db.insert(compositionDerivedCostLines).values(derivedLines.map((line) => ({ compositionId: targetId, name: line.name, basis: line.basis, percentage: line.percentage, notes: line.notes })));
}

export async function forkCompositionToUser(sourceId: string, companyId: string, ownerUserId: string) {
  const [source] = await db.select().from(costCompositions).where(eq(costCompositions.id, sourceId)).limit(1);
  if (!source) return null;
  const [copy] = await db.insert(costCompositions).values({
    companyId,
    ownerUserId,
    visibility: "private",
    parentCompositionId: source.id,
    code: source.code,
    name: source.name,
    category: source.category,
    description: source.description,
    measurementCriteria: source.measurementCriteria,
    executionNotes: source.executionNotes,
    outputUnit: source.outputUnit,
    currency: source.currency,
    auxiliaryCostPct: source.auxiliaryCostPct,
    indirectCostPct: source.indirectCostPct,
    profitMarginPct: source.profitMarginPct,
    version: 1,
    sourceName: source.sourceName,
    sourceReference: source.sourceReference,
    isActive: source.isActive,
    crewSize: source.crewSize,
    productiveHoursPerDay: source.productiveHoursPerDay,
    outputPerDay: source.outputPerDay,
    productivitySource: source.productivitySource,
    productivityNotes: source.productivityNotes,
    defaultMeasurementFormula: source.defaultMeasurementFormula,
  }).returning();
  await copyCompositionLines(sourceId, copy.id);
  return copy;
}

/**
 * Garante uma cópia PRIVADA do utilizador antes de gravar.
 * - Se já é dele → devolve a mesma.
 * - Se já tem fork pessoal do mesmo ancestral → reutiliza.
 * - Caso contrário → cria fork privado e prioriza essa daí em diante.
 */
export async function ensurePersonalEditableCopy(input: {
  source: typeof costCompositions.$inferSelect;
  companyId: string;
  ownerUserId: string;
  /** Super-admin a editar catálogo SIGO global sem clonar. */
  allowGlobalEdit?: boolean;
}) {
  const { source, companyId, ownerUserId } = input;
  if (source.companyId == null && input.allowGlobalEdit) return source;
  if (source.companyId === companyId && source.ownerUserId === ownerUserId) return source;

  const ancestry = [source.id, source.parentCompositionId].filter(Boolean) as string[];
  const [existing] = await db
    .select()
    .from(costCompositions)
    .where(
      and(
        eq(costCompositions.companyId, companyId),
        eq(costCompositions.ownerUserId, ownerUserId),
        eq(costCompositions.visibility, "private"),
        or(
          eq(costCompositions.parentCompositionId, source.id),
          ...(source.parentCompositionId ? [eq(costCompositions.parentCompositionId, source.parentCompositionId)] : []),
          ...(ancestry.length ? ancestry.map((id) => eq(costCompositions.id, id)) : []),
        ),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const forked = await forkCompositionToUser(source.id, companyId, ownerUserId);
  return forked ?? source;
}
