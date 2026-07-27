import { eq, and, or, isNull, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import {
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
  labourCategories,
  materials,
  equipment,
  materialZonePrices,
} from "../db/schema.js";

// Resolve pelo NOME (não pelo id fixado na linha da composição) qual é a linha "visível" da
// empresa para cada recurso — mesma lógica de dedup usada nas listagens do catálogo (própria,
// se existir, senão a partilhada). Necessário porque uma composição pode ter sido clonada para a
// empresa ANTES de esta ter clonado um dos seus ingredientes (ou depois de o ter feito a partir
// de outro sítio) — sem isto, a linha da composição continua presa ao id antigo e um preço
// editado no catálogo (que edita/clona pelo NOME) não chega a esta composição, apesar da UI dizer
// que "todas as composições que usam este material foram recalculadas".
// Exportados também para uso fora deste ficheiro (ex: routes/costCompositions.ts, para o editor
// mostrar o preço que a empresa realmente vai pagar por cada linha, não o preço bruto gravado na
// linha da composição).
export async function resolveByName<Row extends { name: string; companyId: string | null }>(
  rows: Row[]
): Promise<Map<string, Row>> {
  const byName = new Map<string, Row>();
  for (const row of rows) {
    const current = byName.get(row.name);
    if (!current || (current.companyId === null && row.companyId !== null)) byName.set(row.name, row);
  }
  return byName;
}

export function companyScope(companyIdColumn: AnyPgColumn, companyId: string | null) {
  return companyId ? or(isNull(companyIdColumn), eq(companyIdColumn, companyId)) : isNull(companyIdColumn);
}

// Custo/hora = salário mensal / (dias trabalhados/mês * horas trabalhadas/dia).
export function computeHourlyRate(
  monthlySalary: number,
  workingDaysPerMonth: number,
  workingHoursPerDay: number
): number {
  return monthlySalary / (workingDaysPerMonth * workingHoursPerDay);
}

export type CompositionCostBreakdown = {
  compositionId: string;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  unitCost: number;
};

export type CompositionMaterialQuantityLine = {
  materialId: string;
  name: string;
  unit: string;
  qtyPerUnit: number;
  // Custo efectivo por unidade de MEDIDA (já inclui preço de zona quando existir + factor de
  // importação) — value = quantidade_medida × unitCost, mesma semântica de computeCompositionUnitCost.
  unitCost: number;
  currency: string;
  purchasePackageLabel: string | null;
  purchasePackageQty: number | null;
};

// Quantidade (+ custo e unidade de compra) de cada material por unidade de saída da composição —
// mesma resolução por NOME (não pelo id fixado na linha) já usada em computeCompositionUnitCost,
// mas devolvendo a quantidade/preço unitário do material em vez do custo total da composição.
// Usado para "explodir" um item medido (quantidade × qtyPerUnit) nos materiais reais que vai
// consumir, ex: relatório de Materiais por Fase. `zoneId` tem o mesmo efeito que em
// computeCompositionUnitCost: usa o preço da zona quando existir uma excepção gravada.
//
// `requestingCompanyId`: a empresa que está a pedir o cálculo — NUNCA o dono da composição.
// Uma composição do catálogo partilhado (companyId null) pode ser usada por uma empresa que já
// clonou um dos seus ingredientes (ex: mudou o preço do cimento) sem alguma vez ter clonado a
// composição inteira; se resolvêssemos pelo dono da composição, essa alteração de preço nunca
// aparecia no cálculo. `null` (super_admin, sem empresa) só vê preços partilhados.
export async function getCompositionMaterialQuantities(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null
): Promise<CompositionMaterialQuantityLine[]> {
  const [composition] = await db.select().from(costCompositions).where(eq(costCompositions.id, compositionId)).limit(1);
  if (!composition) return [];
  const scope = requestingCompanyId;

  const materialLinesRaw = await db
    .select({
      qtyPerUnit: compositionMaterialLines.qtyPerUnit,
      name: materials.name,
      unit: materials.unit,
      baseUnitCost: materials.baseUnitCost,
      importFactor: materials.importFactor,
      currency: materials.currency,
    })
    .from(compositionMaterialLines)
    .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
    .where(eq(compositionMaterialLines.compositionId, compositionId));

  const materialNames = Array.from(new Set(materialLinesRaw.map((l) => l.name)));
  const resolvedMaterials = materialNames.length
    ? await resolveByName(
        await db
          .select({
            id: materials.id,
            name: materials.name,
            companyId: materials.companyId,
            unit: materials.unit,
            baseUnitCost: materials.baseUnitCost,
            importFactor: materials.importFactor,
            currency: materials.currency,
            purchasePackageLabel: materials.purchasePackageLabel,
            purchasePackageQty: materials.purchasePackageQty,
          })
          .from(materials)
          .where(and(inArray(materials.name, materialNames), companyScope(materials.companyId, scope)))
      )
    : new Map();

  let zoneCostByMaterialId = new Map<string, number>();
  if (zoneId && resolvedMaterials.size) {
    const materialIds = Array.from(resolvedMaterials.values(), (m) => m.id);
    const zonePrices = await db
      .select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost })
      .from(materialZonePrices)
      .where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, materialIds)));
    zoneCostByMaterialId = new Map(zonePrices.map((p) => [p.materialId, Number(p.unitCost)]));
  }

  return materialLinesRaw.map((l) => {
    const resolved = resolvedMaterials.get(l.name);
    const unitCost = (resolved && zoneCostByMaterialId.get(resolved.id)) ?? Number(resolved?.baseUnitCost ?? l.baseUnitCost);
    const importFactor = Number(resolved?.importFactor ?? l.importFactor);
    return {
      materialId: resolved?.id ?? "",
      name: l.name,
      unit: resolved?.unit ?? l.unit,
      qtyPerUnit: Number(l.qtyPerUnit),
      unitCost: unitCost * importFactor,
      currency: resolved?.currency ?? l.currency,
      purchasePackageLabel: resolved?.purchasePackageLabel ?? null,
      purchasePackageQty: resolved?.purchasePackageQty != null ? Number(resolved.purchasePackageQty) : null,
    };
  });
}

// Soma mão-de-obra + materiais + máquinas para obter o preço unitário da composição.
// Chamado no momento em que um line_item passa a referenciar a composição — o valor
// resultante é gravado (snapshot) no line_item, não recalculado retroactivamente.
//
// `zoneId` (opcional): quando o projecto do documento tem uma zona de preço atribuída, o custo de
// cada material passa a usar o preço dessa zona (material_zone_prices) em vez do preço base do
// catálogo, sempre que exista uma linha gravada para esse par (material, zona) — os materiais
// sem preço de zona continuam a usar o preço base normalmente.
//
// `requestingCompanyId`: ver o comentário em getCompositionMaterialQuantities — é sempre a
// empresa que pediu o cálculo, nunca o dono da composição.
export async function computeCompositionUnitCost(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null
): Promise<CompositionCostBreakdown> {
  const [composition] = await db.select().from(costCompositions).where(eq(costCompositions.id, compositionId)).limit(1);
  if (!composition) throw new Error("Composição de custo não encontrada");
  const scope = requestingCompanyId;

  const labourLinesRaw = await db
    .select({ qtyPerUnit: compositionLabourLines.qtyPerUnit, name: labourCategories.name, hourlyRate: labourCategories.hourlyRate })
    .from(compositionLabourLines)
    .innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id))
    .where(eq(compositionLabourLines.compositionId, compositionId));

  const materialLinesRaw = await db
    .select({
      qtyPerUnit: compositionMaterialLines.qtyPerUnit,
      name: materials.name,
      baseUnitCost: materials.baseUnitCost,
      importFactor: materials.importFactor,
    })
    .from(compositionMaterialLines)
    .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
    .where(eq(compositionMaterialLines.compositionId, compositionId));

  const equipmentLinesRaw = await db
    .select({ qtyPerUnit: compositionEquipmentLines.qtyPerUnit, name: equipment.name, hourlyCost: equipment.hourlyCost })
    .from(compositionEquipmentLines)
    .innerJoin(equipment, eq(compositionEquipmentLines.equipmentId, equipment.id))
    .where(eq(compositionEquipmentLines.compositionId, compositionId));

  // Resolve cada linha pelo NOME do recurso dentro do âmbito da empresa dona da composição (a
  // sua própria versão, se existir, senão a partilhada) — não pelo id fixado na linha, que pode
  // estar preso a uma versão antiga/global entretanto substituída por um clone com o mesmo nome.
  const materialNames = Array.from(new Set(materialLinesRaw.map((l) => l.name)));
  const resolvedMaterials = materialNames.length
    ? await resolveByName(
        await db
          .select({ id: materials.id, name: materials.name, companyId: materials.companyId, baseUnitCost: materials.baseUnitCost, importFactor: materials.importFactor })
          .from(materials)
          .where(and(inArray(materials.name, materialNames), companyScope(materials.companyId, scope)))
      )
    : new Map();

  let zoneCostByMaterialId = new Map<string, number>();
  if (zoneId && resolvedMaterials.size) {
    const materialIds = Array.from(resolvedMaterials.values(), (m) => m.id);
    const zonePrices = await db
      .select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost })
      .from(materialZonePrices)
      .where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, materialIds)));
    zoneCostByMaterialId = new Map(zonePrices.map((p) => [p.materialId, Number(p.unitCost)]));
  }

  const labourNames = Array.from(new Set(labourLinesRaw.map((l) => l.name)));
  const resolvedLabour = labourNames.length
    ? await resolveByName(
        await db
          .select({ id: labourCategories.id, name: labourCategories.name, companyId: labourCategories.companyId, hourlyRate: labourCategories.hourlyRate })
          .from(labourCategories)
          .where(and(inArray(labourCategories.name, labourNames), companyScope(labourCategories.companyId, scope)))
      )
    : new Map();

  const equipmentNames = Array.from(new Set(equipmentLinesRaw.map((l) => l.name)));
  const resolvedEquipment = equipmentNames.length
    ? await resolveByName(
        await db
          .select({ id: equipment.id, name: equipment.name, companyId: equipment.companyId, hourlyCost: equipment.hourlyCost })
          .from(equipment)
          .where(and(inArray(equipment.name, equipmentNames), companyScope(equipment.companyId, scope)))
      )
    : new Map();

  const labourCost = labourLinesRaw.reduce((sum, l) => {
    const hourlyRate = resolvedLabour.get(l.name)?.hourlyRate ?? l.hourlyRate;
    return sum + Number(l.qtyPerUnit) * Number(hourlyRate);
  }, 0);
  const materialCost = materialLinesRaw.reduce((sum, l) => {
    const resolved = resolvedMaterials.get(l.name);
    const unitCost = (resolved && zoneCostByMaterialId.get(resolved.id)) ?? Number(resolved?.baseUnitCost ?? l.baseUnitCost);
    const importFactor = Number(resolved?.importFactor ?? l.importFactor);
    return sum + Number(l.qtyPerUnit) * unitCost * importFactor;
  }, 0);
  const equipmentCost = equipmentLinesRaw.reduce((sum, l) => {
    const hourlyCost = resolvedEquipment.get(l.name)?.hourlyCost ?? l.hourlyCost;
    return sum + Number(l.qtyPerUnit) * Number(hourlyCost);
  }, 0);

  return {
    compositionId,
    labourCost,
    materialCost,
    equipmentCost,
    unitCost: labourCost + materialCost + equipmentCost,
  };
}
