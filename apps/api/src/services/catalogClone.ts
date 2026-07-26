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
  const [source] = await db.select().from(labourCategories).where(eq(labourCategories.id, sourceId)).limit(1);
  if (!source) return null;
  const [copy] = await db
    .insert(labourCategories)
    .values({ companyId, name: source.name, monthlySalary: source.monthlySalary, hourlyRate: source.hourlyRate, currency: source.currency })
    .returning();
  return copy;
}

export async function cloneMaterialForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(materials).where(eq(materials.id, sourceId)).limit(1);
  if (!source) return null;
  const [copy] = await db
    .insert(materials)
    .values({
      companyId,
      name: source.name,
      unit: source.unit,
      baseUnitCost: source.baseUnitCost,
      importFactor: source.importFactor,
      currency: source.currency,
      purchasePackageLabel: source.purchasePackageLabel,
      purchasePackageQty: source.purchasePackageQty,
    })
    .returning();
  return copy;
}

export async function cloneEquipmentForCompany(sourceId: string, companyId: string) {
  const [source] = await db.select().from(equipment).where(eq(equipment.id, sourceId)).limit(1);
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
  const [source] = await db.select().from(costCompositions).where(eq(costCompositions.id, sourceId)).limit(1);
  if (!source) return null;

  const [copy] = await db
    .insert(costCompositions)
    .values({ companyId, name: source.name, category: source.category, outputUnit: source.outputUnit, currency: source.currency })
    .returning();

  const [labourLines, materialLines, equipmentLines] = await Promise.all([
    db.select().from(compositionLabourLines).where(eq(compositionLabourLines.compositionId, sourceId)),
    db.select().from(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, sourceId)),
    db.select().from(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, sourceId)),
  ]);
  if (labourLines.length) {
    await db.insert(compositionLabourLines).values(labourLines.map((l) => ({ compositionId: copy.id, labourCategoryId: l.labourCategoryId, qtyPerUnit: l.qtyPerUnit })));
  }
  if (materialLines.length) {
    await db.insert(compositionMaterialLines).values(materialLines.map((l) => ({ compositionId: copy.id, materialId: l.materialId, qtyPerUnit: l.qtyPerUnit })));
  }
  if (equipmentLines.length) {
    await db.insert(compositionEquipmentLines).values(equipmentLines.map((l) => ({ compositionId: copy.id, equipmentId: l.equipmentId, qtyPerUnit: l.qtyPerUnit })));
  }
  return copy;
}
