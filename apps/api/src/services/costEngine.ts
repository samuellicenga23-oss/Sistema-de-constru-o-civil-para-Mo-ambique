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
  priceZones,
} from "../db/schema.js";
import { priceExcludingVat } from "@sigo/shared";

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
  workingHoursPerDay: number,
  productiveHoursPerMonth?: number | null,
  socialChargesPct = 0,
  complementaryCostsPct = 0
): number {
  const productiveHours = productiveHoursPerMonth && productiveHoursPerMonth > 0
    ? productiveHoursPerMonth
    : workingDaysPerMonth * workingHoursPerDay;
  const baseHourlyRate = monthlySalary / productiveHours;
  return baseHourlyRate * (1 + (socialChargesPct + complementaryCostsPct) / 100);
}

export function calculateCompositionTotals(input: {
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
}) {
  const directCost = input.labourCost + input.materialCost + input.equipmentCost;
  // A composição representa apenas o custo técnico directo. Custos de estaleiro,
  // contingências, margem e IVA são parâmetros globais do Mapa de Quantidades.
  return { directCost, auxiliaryCost: 0, indirectCost: 0, profit: 0, unitCost: directCost };
}

export type CompositionCostBreakdown = {
  compositionId: string;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  directCost: number;
  auxiliaryCost: number;
  indirectCost: number;
  profit: number;
  unitCost: number;
  qualityScore: number;
  qualityWarnings: string[];
  isReady: boolean;
};

export type CompositionMaterialQuantityLine = {
  materialId: string;
  name: string;
  unit: string;
  qtyPerUnit: number;
  baseQtyPerUnit: number;
  wastePct: number;
  // Custo efectivo por unidade de MEDIDA (já inclui preço de zona quando existir + factor de
  // importação) — value = quantidade_medida × unitCost, mesma semântica de computeCompositionUnitCost.
  unitCost: number;
  currency: string;
  purchasePackageLabel: string | null;
  purchasePackageQty: number | null;
};

export type CompositionLabourQuantityLine = {
  labourCategoryId: string;
  name: string;
  hoursPerUnit: number;
  hourlyRate: number;
  currency: string;
};

// Horas de cada categoria por unidade da composição. Usa a categoria própria da empresa quando
// existir e aplica o factor de mão-de-obra da zona exactamente como o preço da composição.
export async function getCompositionLabourQuantities(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null
): Promise<CompositionLabourQuantityLine[]> {
  const labourLinesRaw = await db
    .select({ qtyPerUnit: compositionLabourLines.qtyPerUnit, name: labourCategories.name, hourlyRate: labourCategories.hourlyRate, currency: labourCategories.currency })
    .from(compositionLabourLines)
    .innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id))
    .where(eq(compositionLabourLines.compositionId, compositionId));
  const names = Array.from(new Set(labourLinesRaw.map((line) => line.name)));
  const resolved = names.length
    ? await resolveByName(
        await db
          .select({ id: labourCategories.id, name: labourCategories.name, companyId: labourCategories.companyId, hourlyRate: labourCategories.hourlyRate, currency: labourCategories.currency })
          .from(labourCategories)
          .where(and(inArray(labourCategories.name, names), companyScope(labourCategories.companyId, requestingCompanyId)))
      )
    : new Map();
  const [zone] = zoneId
    ? await db.select({ labourAdjustmentPct: priceZones.labourAdjustmentPct }).from(priceZones).where(and(eq(priceZones.id, zoneId), companyScope(priceZones.companyId, requestingCompanyId))).limit(1)
    : [undefined];
  const zoneFactor = 1 + Number(zone?.labourAdjustmentPct ?? 0) / 100;
  return labourLinesRaw.map((line) => {
    const category = resolved.get(line.name);
    return {
      labourCategoryId: category?.id ?? "",
      name: line.name,
      hoursPerUnit: Number(line.qtyPerUnit),
      hourlyRate: Number(category?.hourlyRate ?? line.hourlyRate) * zoneFactor,
      currency: category?.currency ?? line.currency,
    };
  });
}

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
      wastePct: compositionMaterialLines.wastePct,
      name: materials.name,
      unit: materials.unit,
      baseUnitCost: materials.baseUnitCost,
      importFactor: materials.importFactor,
      includesVat: materials.includesVat,
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
            includesVat: materials.includesVat,
            currency: materials.currency,
            purchasePackageLabel: materials.purchasePackageLabel,
            purchasePackageQty: materials.purchasePackageQty,
          })
          .from(materials)
          .where(and(inArray(materials.name, materialNames), companyScope(materials.companyId, scope)))
      )
    : new Map();

  let zoneCostByMaterialId = new Map<string, { unitCost: number; includesVat: boolean }>();
  let materialZoneFactor = 1;
  if (zoneId && resolvedMaterials.size) {
    const [zone] = await db.select().from(priceZones).where(and(eq(priceZones.id, zoneId), companyScope(priceZones.companyId, requestingCompanyId))).limit(1);
    if (zone) {
      materialZoneFactor = (1 + Number(zone.materialAdjustmentPct) / 100)
        * (1 + Number(zone.defaultTransportPct) / 100);
      const materialIds = Array.from(resolvedMaterials.values(), (m) => m.id);
      const zonePrices = await db
        .select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost, includesVat: materialZonePrices.includesVat })
        .from(materialZonePrices)
        .where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, materialIds)));
      zoneCostByMaterialId = new Map(zonePrices.map((p) => [p.materialId, { unitCost: Number(p.unitCost), includesVat: p.includesVat }]));
    }
  }

  return materialLinesRaw.map((l) => {
    const resolved = resolvedMaterials.get(l.name);
    const explicitZoneCost = resolved ? zoneCostByMaterialId.get(resolved.id) : undefined;
    const listedUnitCost = explicitZoneCost?.unitCost ?? Number(resolved?.baseUnitCost ?? l.baseUnitCost) * materialZoneFactor;
    const unitCost = priceExcludingVat(listedUnitCost, explicitZoneCost?.includesVat ?? resolved?.includesVat ?? l.includesVat);
    const importFactor = Number(resolved?.importFactor ?? l.importFactor);
    return {
      materialId: resolved?.id ?? "",
      name: l.name,
      unit: resolved?.unit ?? l.unit,
      baseQtyPerUnit: Number(l.qtyPerUnit),
      wastePct: Number(l.wastePct),
      qtyPerUnit: Number(l.qtyPerUnit) * (1 + Number(l.wastePct) / 100),
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
/** Cliente Drizzle (db ou transação) — necessário para ver composições criadas na mesma TX. */
type CostQueryClient = Pick<typeof db, "select">;

export async function computeCompositionUnitCost(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null,
  client: CostQueryClient = db,
): Promise<CompositionCostBreakdown> {
  const [composition] = await client.select().from(costCompositions).where(eq(costCompositions.id, compositionId)).limit(1);
  if (!composition) throw new Error("Composição de custo não encontrada");
  const scope = requestingCompanyId;

  const [zone] = zoneId
    ? await client.select().from(priceZones).where(and(eq(priceZones.id, zoneId), companyScope(priceZones.companyId, requestingCompanyId))).limit(1)
    : [undefined];
  const labourZoneFactor = 1 + Number(zone?.labourAdjustmentPct ?? 0) / 100;
  const equipmentZoneFactor = 1 + Number(zone?.equipmentAdjustmentPct ?? 0) / 100;
  const materialZoneFactor = (1 + Number(zone?.materialAdjustmentPct ?? 0) / 100)
    * (1 + Number(zone?.defaultTransportPct ?? 0) / 100);

  const labourLinesRaw = await client
    .select({ qtyPerUnit: compositionLabourLines.qtyPerUnit, name: labourCategories.name, hourlyRate: labourCategories.hourlyRate })
    .from(compositionLabourLines)
    .innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id))
    .where(eq(compositionLabourLines.compositionId, compositionId));

  const materialLinesRaw = await client
    .select({
      qtyPerUnit: compositionMaterialLines.qtyPerUnit,
      wastePct: compositionMaterialLines.wastePct,
      name: materials.name,
      baseUnitCost: materials.baseUnitCost,
      importFactor: materials.importFactor,
      includesVat: materials.includesVat,
    })
    .from(compositionMaterialLines)
    .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
    .where(eq(compositionMaterialLines.compositionId, compositionId));

  const equipmentLinesRaw = await client
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
        await client
          .select({ id: materials.id, name: materials.name, companyId: materials.companyId, baseUnitCost: materials.baseUnitCost, importFactor: materials.importFactor, includesVat: materials.includesVat })
          .from(materials)
          .where(and(inArray(materials.name, materialNames), companyScope(materials.companyId, scope)))
      )
    : new Map();

  let zoneCostByMaterialId = new Map<string, { unitCost: number; includesVat: boolean }>();
  if (zoneId && zone && resolvedMaterials.size) {
    const materialIds = Array.from(resolvedMaterials.values(), (m) => m.id);
    const zonePrices = await client
      .select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost, includesVat: materialZonePrices.includesVat })
      .from(materialZonePrices)
      .where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, materialIds)));
    zoneCostByMaterialId = new Map(zonePrices.map((p) => [p.materialId, { unitCost: Number(p.unitCost), includesVat: p.includesVat }]));
  }

  const labourNames = Array.from(new Set(labourLinesRaw.map((l) => l.name)));
  const resolvedLabour = labourNames.length
    ? await resolveByName(
        await client
          .select({ id: labourCategories.id, name: labourCategories.name, companyId: labourCategories.companyId, hourlyRate: labourCategories.hourlyRate })
          .from(labourCategories)
          .where(and(inArray(labourCategories.name, labourNames), companyScope(labourCategories.companyId, scope)))
      )
    : new Map();

  const equipmentNames = Array.from(new Set(equipmentLinesRaw.map((l) => l.name)));
  const resolvedEquipment = equipmentNames.length
    ? await resolveByName(
        await client
          .select({ id: equipment.id, name: equipment.name, companyId: equipment.companyId, hourlyCost: equipment.hourlyCost })
          .from(equipment)
          .where(and(inArray(equipment.name, equipmentNames), companyScope(equipment.companyId, scope)))
      )
    : new Map();

  const labourCost = labourLinesRaw.reduce((sum, l) => {
    const hourlyRate = resolvedLabour.get(l.name)?.hourlyRate ?? l.hourlyRate;
    return sum + Number(l.qtyPerUnit) * Number(hourlyRate) * labourZoneFactor;
  }, 0);
  const materialCost = materialLinesRaw.reduce((sum, l) => {
    const resolved = resolvedMaterials.get(l.name);
    const explicitZoneCost = resolved ? zoneCostByMaterialId.get(resolved.id) : undefined;
    const listedUnitCost = explicitZoneCost?.unitCost ?? Number(resolved?.baseUnitCost ?? l.baseUnitCost) * materialZoneFactor;
    const unitCost = priceExcludingVat(listedUnitCost, explicitZoneCost?.includesVat ?? resolved?.includesVat ?? l.includesVat);
    const importFactor = Number(resolved?.importFactor ?? l.importFactor);
    const wasteFactor = 1 + Number(l.wastePct) / 100;
    return sum + Number(l.qtyPerUnit) * wasteFactor * unitCost * importFactor;
  }, 0);
  const equipmentCost = equipmentLinesRaw.reduce((sum, l) => {
    const hourlyCost = resolvedEquipment.get(l.name)?.hourlyCost ?? l.hourlyCost;
    return sum + Number(l.qtyPerUnit) * Number(hourlyCost) * equipmentZoneFactor;
  }, 0);

  const totals = calculateCompositionTotals({
    labourCost,
    materialCost,
    equipmentCost,
  });

  const qualityWarnings: string[] = [];
  const lineCount = labourLinesRaw.length + materialLinesRaw.length + equipmentLinesRaw.length;
  if (lineCount === 0) qualityWarnings.push("A composição ainda não tem recursos associados.");
  if (!composition.code) qualityWarnings.push("Defina um código para rastrear esta composição.");
  if (!composition.measurementCriteria) qualityWarnings.push("Registe o critério de medição e pagamento.");
  if (!composition.sourceName) qualityWarnings.push("Indique a fonte técnica ou metodologia usada.");
  if (totals.directCost <= 0) qualityWarnings.push("O custo directo calculado é zero.");
  if (zone && resolvedMaterials.size > zoneCostByMaterialId.size) {
    qualityWarnings.push("Alguns materiais não têm preço próprio nesta zona; foi aplicado o ajuste geral da zona.");
  }
  let qualityScore = 100;
  if (lineCount === 0) qualityScore -= 40;
  if (!composition.code) qualityScore -= 10;
  if (!composition.measurementCriteria) qualityScore -= 15;
  if (!composition.sourceName) qualityScore -= 10;
  if (totals.directCost <= 0) qualityScore -= 25;
  if (zone && resolvedMaterials.size > zoneCostByMaterialId.size) qualityScore -= 5;
  qualityScore = Math.max(0, qualityScore);

  return {
    compositionId,
    labourCost,
    materialCost,
    equipmentCost,
    ...totals,
    qualityScore,
    qualityWarnings,
    isReady: lineCount > 0 && totals.directCost > 0 && qualityScore >= 50,
  };
}
