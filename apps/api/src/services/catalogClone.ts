import { eq, isNull, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  labourCategories,
  materials,
  equipment,
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
} from "../db/schema.js";

// Clonagem transparente: quando uma empresa "edita" um item do catálogo partilhado,
// o sistema copia-o silenciosamente para a empresa e aplica a edição na cópia — do
// ponto de vista do utilizador nunca há um passo de "clonar", só edita e pronto.
// O item global original nunca é alterado (continua igual para as outras empresas).

export async function cloneLabourCategoryForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(labourCategories).where(and(eq(labourCategories.id, sourceId), isNull(labourCategories.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db
    .insert(labourCategories)
    .values({
      companyId,
      code: source.code,
      name: source.name,
      monthlySalary: source.monthlySalary,
      productiveHoursPerMonth: source.productiveHoursPerMonth,
      socialChargesPct: source.socialChargesPct,
      complementaryCostsPct: source.complementaryCostsPct,
      hourlyRate: source.hourlyRate,
      currency: source.currency,
      sourceName: source.sourceName,
      sourceReference: source.sourceReference,
      effectiveDate: source.effectiveDate,
      isActive: source.isActive,
    })
    .returning();
  return copy;
}

export async function cloneMaterialForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(materials).where(and(eq(materials.id, sourceId), isNull(materials.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db
    .insert(materials)
    .values({
      companyId,
      code: source.code,
      name: source.name,
      category: source.category,
      specification: source.specification,
      unit: source.unit,
      baseUnitCost: source.baseUnitCost,
      importFactor: source.importFactor,
      defaultWastePct: source.defaultWastePct,
      currency: source.currency,
      priceSourceName: source.priceSourceName,
      sourceReference: source.sourceReference,
      priceDate: source.priceDate,
      includesVat: source.includesVat,
      isActive: source.isActive,
      purchasePackageLabel: source.purchasePackageLabel,
      purchasePackageQty: source.purchasePackageQty,
    })
    .returning();
  return copy;
}

export async function cloneEquipmentForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(equipment).where(and(eq(equipment.id, sourceId), isNull(equipment.companyId))).limit(1);
  if (!source) return null;
  const [copy] = await db
    .insert(equipment)
    .values({ companyId, name: source.name, unit: source.unit, hourlyCost: source.hourlyCost, currency: source.currency })
    .returning();
  return copy;
}

// Actualiza o preço de um material identificando-o pelo NOME (visível à empresa: própria
// ou partilhado) — usado pelo Assistente de Medições para actualizar preços-chave (cimento,
// aço, bloco) sem o utilizador ter de ir ao catálogo. Clona automaticamente se for partilhado.
export async function setMaterialPriceByName(companyId: string, name: string, baseUnitCost: number): Promise<boolean> {
  const [own] = await db.select().from(materials).where(and(eq(materials.name, name), eq(materials.companyId, companyId))).limit(1);
  if (own) {
    await db.update(materials).set({ baseUnitCost: baseUnitCost.toString() }).where(eq(materials.id, own.id));
    return true;
  }
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

  const [copy] = await db
    .insert(costCompositions)
    .values({
      companyId,
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
      version: source.version,
      sourceName: source.sourceName,
      sourceReference: source.sourceReference,
      isActive: source.isActive,
    })
    .returning();

  const [labourLines, materialLines, equipmentLines] = await Promise.all([
    db.select().from(compositionLabourLines).where(eq(compositionLabourLines.compositionId, sourceId)),
    db.select().from(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, sourceId)),
    db.select().from(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, sourceId)),
  ]);
  if (labourLines.length) {
    await db.insert(compositionLabourLines).values(labourLines.map((l) => ({ compositionId: copy.id, labourCategoryId: l.labourCategoryId, qtyPerUnit: l.qtyPerUnit, notes: l.notes })));
  }
  if (materialLines.length) {
    await db.insert(compositionMaterialLines).values(materialLines.map((l) => ({ compositionId: copy.id, materialId: l.materialId, qtyPerUnit: l.qtyPerUnit, wastePct: l.wastePct, notes: l.notes })));
  }
  if (equipmentLines.length) {
    await db.insert(compositionEquipmentLines).values(equipmentLines.map((l) => ({ compositionId: copy.id, equipmentId: l.equipmentId, qtyPerUnit: l.qtyPerUnit, notes: l.notes })));
  }
  return copy;
}
