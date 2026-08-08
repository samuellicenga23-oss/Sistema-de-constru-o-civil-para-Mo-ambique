import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import {
  compositionDerivedCostLines,
  compositionEquipmentLines,
  compositionLabourLines,
  compositionMaterialLines,
  compositionSubcompositionLines,
  costCompositions,
  equipment,
  labourCategories,
  materials,
  materialZonePrices,
  priceZones,
} from "../db/schema.js";
import { priceExcludingVat } from "@sigo/shared";
import {
  assertAcyclicCompositionGraph,
  computeCompositionProductivity,
  computeDerivedCosts,
  resolveResourcesByIdentity,
  roundCost,
  type SubcompositionEdge,
} from "./compositionV2Engine.js";

export type CompositionCostBreakdownV2 = {
  compositionId: string;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  subcompositionCost: number;
  derivedCost: number;
  labourHoursPerUnit: number;
  directCost: number;
  auxiliaryCost: 0;
  indirectCost: 0;
  profit: 0;
  unitCost: number;
  qualityScore: number;
  qualityWarnings: string[];
  isReady: boolean;
  derivedCostLines: Array<{ id: string; name: string; basis: string; percentage: number; base: number; amount: number }>;
  subcompositions: Array<{ id: string; subcompositionId: string; name: string; qtyPerUnit: number; unitCost: number; subtotal: number }>;
  productivity: {
    crewSize: number | null;
    productiveHoursPerDay: number | null;
    outputPerDay: number | null;
    outputPerHour: number | null;
    productivitySource: string | null;
    productivityNotes: string | null;
    basis: "explicit_output" | "labour_hours" | "missing";
  };
};

export type CompositionMaterialQuantityLineV2 = {
  materialId: string;
  familyKey: string;
  name: string;
  unit: string;
  qtyPerUnit: number;
  baseQtyPerUnit: number;
  wastePct: number;
  unitCost: number;
  currency: string;
  purchasePackageLabel: string | null;
  purchasePackageQty: number | null;
};

export type CompositionLabourQuantityLineV2 = {
  labourCategoryId: string;
  familyKey: string;
  name: string;
  hoursPerUnit: number;
  hourlyRate: number;
  currency: string;
};

type Client = Pick<typeof db, "select">;

function companyScope(companyIdColumn: AnyPgColumn, companyId: string | null) {
  return companyId ? or(isNull(companyIdColumn), eq(companyIdColumn, companyId)) : isNull(companyIdColumn);
}

function chooseVisible<T extends { id: string; familyKey: string; name: string; companyId: string | null }>(rows: T[]) {
  return resolveResourcesByIdentity(rows);
}

async function loadAllEdges(client: Client): Promise<SubcompositionEdge[]> {
  const rows = await client.select().from(compositionSubcompositionLines);
  return rows.map((row) => ({ compositionId: row.compositionId, subcompositionId: row.subcompositionId, qtyPerUnit: Number(row.qtyPerUnit) }));
}

async function loadBaseResourceFacts(compositionId: string, requestingCompanyId: string | null, zoneId: string | null | undefined, client: Client) {
  const [zone] = zoneId
    ? await client.select().from(priceZones).where(and(eq(priceZones.id, zoneId), companyScope(priceZones.companyId, requestingCompanyId))).limit(1)
    : [undefined];
  const labourZoneFactor = 1 + Number(zone?.labourAdjustmentPct ?? 0) / 100;
  const equipmentZoneFactor = 1 + Number(zone?.equipmentAdjustmentPct ?? 0) / 100;
  const materialZoneFactor = (1 + Number(zone?.materialAdjustmentPct ?? 0) / 100) * (1 + Number(zone?.defaultTransportPct ?? 0) / 100);

  const [labourRaw, materialRaw, equipmentRaw] = await Promise.all([
    client.select({ qtyPerUnit: compositionLabourLines.qtyPerUnit, name: labourCategories.name, familyKey: labourCategories.familyKey, hourlyRate: labourCategories.hourlyRate, currency: labourCategories.currency })
      .from(compositionLabourLines).innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id)).where(eq(compositionLabourLines.compositionId, compositionId)),
    client.select({ qtyPerUnit: compositionMaterialLines.qtyPerUnit, wastePct: compositionMaterialLines.wastePct, name: materials.name, familyKey: materials.familyKey, unit: materials.unit, baseUnitCost: materials.baseUnitCost, importFactor: materials.importFactor, includesVat: materials.includesVat, currency: materials.currency })
      .from(compositionMaterialLines).innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id)).where(eq(compositionMaterialLines.compositionId, compositionId)),
    client.select({ qtyPerUnit: compositionEquipmentLines.qtyPerUnit, name: equipment.name, familyKey: equipment.familyKey, hourlyCost: equipment.hourlyCost, currency: equipment.currency })
      .from(compositionEquipmentLines).innerJoin(equipment, eq(compositionEquipmentLines.equipmentId, equipment.id)).where(eq(compositionEquipmentLines.compositionId, compositionId)),
  ]);

  const labourFamilies = [...new Set(labourRaw.map((row) => row.familyKey))];
  const materialFamilies = [...new Set(materialRaw.map((row) => row.familyKey))];
  const equipmentFamilies = [...new Set(equipmentRaw.map((row) => row.familyKey))];
  const [labourCandidates, materialCandidates, equipmentCandidates] = await Promise.all([
    labourFamilies.length ? client.select({ id: labourCategories.id, familyKey: labourCategories.familyKey, name: labourCategories.name, companyId: labourCategories.companyId, hourlyRate: labourCategories.hourlyRate, currency: labourCategories.currency, sourceName: labourCategories.sourceName, effectiveDate: labourCategories.effectiveDate }).from(labourCategories).where(and(inArray(labourCategories.familyKey, labourFamilies), companyScope(labourCategories.companyId, requestingCompanyId))) : Promise.resolve([]),
    materialFamilies.length ? client.select({ id: materials.id, familyKey: materials.familyKey, name: materials.name, companyId: materials.companyId, unit: materials.unit, baseUnitCost: materials.baseUnitCost, importFactor: materials.importFactor, includesVat: materials.includesVat, currency: materials.currency, purchasePackageLabel: materials.purchasePackageLabel, purchasePackageQty: materials.purchasePackageQty, priceSourceName: materials.priceSourceName, priceDate: materials.priceDate }).from(materials).where(and(inArray(materials.familyKey, materialFamilies), companyScope(materials.companyId, requestingCompanyId))) : Promise.resolve([]),
    equipmentFamilies.length ? client.select({ id: equipment.id, familyKey: equipment.familyKey, name: equipment.name, companyId: equipment.companyId, hourlyCost: equipment.hourlyCost, currency: equipment.currency }).from(equipment).where(and(inArray(equipment.familyKey, equipmentFamilies), companyScope(equipment.companyId, requestingCompanyId))) : Promise.resolve([]),
  ]);
  const resolvedLabour = chooseVisible(labourCandidates);
  const resolvedMaterials = chooseVisible(materialCandidates);
  const resolvedEquipment = chooseVisible(equipmentCandidates);

  let zoneCostByMaterialId = new Map<string, { unitCost: number; includesVat: boolean; sourceName: string | null; effectiveDate: string | null }>();
  if (zoneId && zone && resolvedMaterials.size) {
    const ids = [...resolvedMaterials.values()].map((row) => row.id);
    const rows = await client.select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost, includesVat: materialZonePrices.includesVat, sourceName: materialZonePrices.sourceName, effectiveDate: materialZonePrices.effectiveDate })
      .from(materialZonePrices).where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, ids)));
    zoneCostByMaterialId = new Map(rows.map((row) => [row.materialId, { unitCost: Number(row.unitCost), includesVat: row.includesVat, sourceName: row.sourceName, effectiveDate: row.effectiveDate }]));
  }

  const labourLines = labourRaw.map((line) => {
    const resolved = resolvedLabour.get(line.familyKey);
    return {
      familyKey: line.familyKey, id: resolved?.id ?? "", name: resolved?.name ?? line.name, qtyPerUnit: Number(line.qtyPerUnit),
      hourlyRate: Number(resolved?.hourlyRate ?? line.hourlyRate) * labourZoneFactor, currency: resolved?.currency ?? line.currency,
      priceSourceName: resolved?.sourceName ?? null, priceDate: resolved?.effectiveDate ?? null,
    };
  });
  const materialLines = materialRaw.map((line) => {
    const resolved = resolvedMaterials.get(line.familyKey);
    const explicitZone = resolved ? zoneCostByMaterialId.get(resolved.id) : undefined;
    const listed = explicitZone?.unitCost ?? Number(resolved?.baseUnitCost ?? line.baseUnitCost) * materialZoneFactor;
    const costExVat = priceExcludingVat(listed, explicitZone?.includesVat ?? resolved?.includesVat ?? line.includesVat);
    const importFactor = Number(resolved?.importFactor ?? line.importFactor);
    return {
      familyKey: line.familyKey, id: resolved?.id ?? "", name: resolved?.name ?? line.name, unit: resolved?.unit ?? line.unit,
      baseQtyPerUnit: Number(line.qtyPerUnit), wastePct: Number(line.wastePct), qtyPerUnit: Number(line.qtyPerUnit) * (1 + Number(line.wastePct) / 100),
      unitCost: costExVat * importFactor, currency: resolved?.currency ?? line.currency,
      purchasePackageLabel: resolved?.purchasePackageLabel ?? null,
      purchasePackageQty: resolved?.purchasePackageQty == null ? null : Number(resolved.purchasePackageQty),
      priceSourceName: explicitZone?.sourceName ?? resolved?.priceSourceName ?? null,
      priceDate: explicitZone?.effectiveDate ?? resolved?.priceDate ?? null,
      priceOrigin: explicitZone ? "zone" as const : "catalog" as const,
    };
  });
  const equipmentLines = equipmentRaw.map((line) => {
    const resolved = resolvedEquipment.get(line.familyKey);
    return {
      familyKey: line.familyKey, id: resolved?.id ?? "", name: resolved?.name ?? line.name, qtyPerUnit: Number(line.qtyPerUnit),
      hourlyCost: Number(resolved?.hourlyCost ?? line.hourlyCost) * equipmentZoneFactor, currency: resolved?.currency ?? line.currency,
      priceSourceName: null as string | null, priceDate: null as string | null,
    };
  });
  return { zone, labourLines, materialLines, equipmentLines };
}

export async function getCompositionMaterialQuantitiesV2(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null,
  stack: string[] = [],
): Promise<CompositionMaterialQuantityLineV2[]> {
  if (stack.includes(compositionId)) throw new Error(`Ciclo de subcomposições detectado: ${[...stack, compositionId].join(" → ")}`);
  const facts = await loadBaseResourceFacts(compositionId, requestingCompanyId, zoneId, db);
  const rows: CompositionMaterialQuantityLineV2[] = facts.materialLines.map((line) => ({
    materialId: line.id, familyKey: line.familyKey, name: line.name, unit: line.unit,
    qtyPerUnit: line.qtyPerUnit, baseQtyPerUnit: line.baseQtyPerUnit, wastePct: line.wastePct,
    unitCost: line.unitCost, currency: line.currency, purchasePackageLabel: line.purchasePackageLabel, purchasePackageQty: line.purchasePackageQty,
  }));
  const subLines = await db.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, compositionId));
  for (const sub of subLines) {
    const child = await getCompositionMaterialQuantitiesV2(sub.subcompositionId, requestingCompanyId, zoneId, [...stack, compositionId]);
    const multiplier = Number(sub.qtyPerUnit);
    for (const line of child) rows.push({ ...line, qtyPerUnit: line.qtyPerUnit * multiplier, baseQtyPerUnit: line.baseQtyPerUnit * multiplier });
  }
  const grouped = new Map<string, CompositionMaterialQuantityLineV2>();
  for (const row of rows) {
    const current = grouped.get(row.familyKey);
    if (!current) grouped.set(row.familyKey, { ...row });
    else {
      current.qtyPerUnit += row.qtyPerUnit;
      current.baseQtyPerUnit += row.baseQtyPerUnit;
      // Custo unitário representa o recurso actual; linhas da mesma familyKey devem convergir para o mesmo preço.
      current.unitCost = row.unitCost;
    }
  }
  return [...grouped.values()];
}

export async function getCompositionLabourQuantitiesV2(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null,
  stack: string[] = [],
): Promise<CompositionLabourQuantityLineV2[]> {
  if (stack.includes(compositionId)) throw new Error(`Ciclo de subcomposições detectado: ${[...stack, compositionId].join(" → ")}`);
  const facts = await loadBaseResourceFacts(compositionId, requestingCompanyId, zoneId, db);
  const rows: CompositionLabourQuantityLineV2[] = facts.labourLines.map((line) => ({
    labourCategoryId: line.id, familyKey: line.familyKey, name: line.name, hoursPerUnit: line.qtyPerUnit, hourlyRate: line.hourlyRate, currency: line.currency,
  }));
  const subLines = await db.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, compositionId));
  for (const sub of subLines) {
    const child = await getCompositionLabourQuantitiesV2(sub.subcompositionId, requestingCompanyId, zoneId, [...stack, compositionId]);
    const multiplier = Number(sub.qtyPerUnit);
    for (const line of child) rows.push({ ...line, hoursPerUnit: line.hoursPerUnit * multiplier });
  }
  const grouped = new Map<string, CompositionLabourQuantityLineV2>();
  for (const row of rows) {
    const current = grouped.get(row.familyKey);
    if (!current) grouped.set(row.familyKey, { ...row });
    else { current.hoursPerUnit += row.hoursPerUnit; current.hourlyRate = row.hourlyRate; }
  }
  return [...grouped.values()];
}

export type EffectiveCompositionResourcesV2 = {
  labour: Array<{ labourCategoryId: string; familyKey: string; name: string; hoursPerUnit: number; hourlyRate: number; currency: string; priceSourceName: string | null; priceDate: string | null }>;
  materials: Array<{ materialId: string; familyKey: string; name: string; unit: string; qtyPerUnit: number; unitCost: number; currency: string; priceSourceName: string | null; priceDate: string | null; priceOrigin: "zone" | "catalog" }>;
  equipment: Array<{ equipmentId: string; familyKey: string; name: string; hoursPerUnit: number; hourlyCost: number; currency: string; priceSourceName: string | null; priceDate: string | null }>;
};

/**
 * Recursos efectivos que realmente suportam a APU nesta empresa/zona, já incluindo
 * subcomposições e clones por familyKey. Usado por snapshots auditáveis para que o documento
 * não grave o preço bruto do recurso global quando o cálculo usou a versão própria da empresa.
 */
export async function getCompositionEffectiveResourcesV2(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null,
  client: Client = db,
  stack: string[] = [],
): Promise<EffectiveCompositionResourcesV2> {
  if (stack.includes(compositionId)) throw new Error(`Ciclo de subcomposições detectado: ${[...stack, compositionId].join(" → ")}`);
  if (stack.length >= 12) throw new Error("Profundidade máxima de subcomposições excedida");
  const facts = await loadBaseResourceFacts(compositionId, requestingCompanyId, zoneId, client);
  const labour: EffectiveCompositionResourcesV2["labour"] = facts.labourLines.map((line) => ({ labourCategoryId: line.id, familyKey: line.familyKey, name: line.name, hoursPerUnit: line.qtyPerUnit, hourlyRate: line.hourlyRate, currency: line.currency, priceSourceName: line.priceSourceName, priceDate: line.priceDate }));
  const materialsOut: EffectiveCompositionResourcesV2["materials"] = facts.materialLines.map((line) => ({ materialId: line.id, familyKey: line.familyKey, name: line.name, unit: line.unit, qtyPerUnit: line.qtyPerUnit, unitCost: line.unitCost, currency: line.currency, priceSourceName: line.priceSourceName, priceDate: line.priceDate, priceOrigin: line.priceOrigin }));
  const equipmentOut: EffectiveCompositionResourcesV2["equipment"] = facts.equipmentLines.map((line) => ({ equipmentId: line.id, familyKey: line.familyKey, name: line.name, hoursPerUnit: line.qtyPerUnit, hourlyCost: line.hourlyCost, currency: line.currency, priceSourceName: line.priceSourceName, priceDate: line.priceDate }));
  const subLines = await client.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, compositionId));
  for (const sub of subLines) {
    const multiplier = Number(sub.qtyPerUnit);
    const child = await getCompositionEffectiveResourcesV2(sub.subcompositionId, requestingCompanyId, zoneId, client, [...stack, compositionId]);
    labour.push(...child.labour.map((line) => ({ ...line, hoursPerUnit: line.hoursPerUnit * multiplier })));
    materialsOut.push(...child.materials.map((line) => ({ ...line, qtyPerUnit: line.qtyPerUnit * multiplier })));
    equipmentOut.push(...child.equipment.map((line) => ({ ...line, hoursPerUnit: line.hoursPerUnit * multiplier })));
  }
  const labourByFamily = new Map<string, EffectiveCompositionResourcesV2["labour"][number]>();
  for (const row of labour) { const cur = labourByFamily.get(row.familyKey); if (!cur) labourByFamily.set(row.familyKey, { ...row }); else { cur.hoursPerUnit += row.hoursPerUnit; cur.hourlyRate = row.hourlyRate; cur.priceSourceName = row.priceSourceName; cur.priceDate = row.priceDate; } }
  const materialByFamily = new Map<string, EffectiveCompositionResourcesV2["materials"][number]>();
  for (const row of materialsOut) { const cur = materialByFamily.get(row.familyKey); if (!cur) materialByFamily.set(row.familyKey, { ...row }); else { cur.qtyPerUnit += row.qtyPerUnit; cur.unitCost = row.unitCost; cur.priceSourceName = row.priceSourceName; cur.priceDate = row.priceDate; cur.priceOrigin = row.priceOrigin; } }
  const equipmentByFamily = new Map<string, EffectiveCompositionResourcesV2["equipment"][number]>();
  for (const row of equipmentOut) { const cur = equipmentByFamily.get(row.familyKey); if (!cur) equipmentByFamily.set(row.familyKey, { ...row }); else { cur.hoursPerUnit += row.hoursPerUnit; cur.hourlyCost = row.hourlyCost; cur.priceSourceName = row.priceSourceName; cur.priceDate = row.priceDate; } }
  return { labour: [...labourByFamily.values()], materials: [...materialByFamily.values()], equipment: [...equipmentByFamily.values()] };
}

export async function computeCompositionUnitCostV2(
  compositionId: string,
  requestingCompanyId: string | null,
  zoneId?: string | null,
  client: Client = db,
  stack: string[] = [],
  allEdges?: SubcompositionEdge[],
): Promise<CompositionCostBreakdownV2> {
  if (stack.includes(compositionId)) throw new Error(`Ciclo de subcomposições detectado: ${[...stack, compositionId].join(" → ")}`);
  if (stack.length >= 12) throw new Error("Profundidade máxima de subcomposições excedida");
  const [composition] = await client.select().from(costCompositions).where(eq(costCompositions.id, compositionId)).limit(1);
  if (!composition) throw new Error("Composição de custo não encontrada");

  const edges = allEdges ?? await loadAllEdges(client);
  assertAcyclicCompositionGraph(compositionId, edges);
  const facts = await loadBaseResourceFacts(compositionId, requestingCompanyId, zoneId, client);
  const directLabourHoursPerUnit = facts.labourLines.reduce((sum, line) => sum + line.qtyPerUnit, 0);
  const labourCost = roundCost(facts.labourLines.reduce((sum, line) => sum + line.qtyPerUnit * line.hourlyRate, 0));
  const materialCost = roundCost(facts.materialLines.reduce((sum, line) => sum + line.qtyPerUnit * line.unitCost, 0));
  const equipmentCost = roundCost(facts.equipmentLines.reduce((sum, line) => sum + line.qtyPerUnit * line.hourlyCost, 0));

  const subLines = await client.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, compositionId));
  const subcompositions: CompositionCostBreakdownV2["subcompositions"] = [];
  let subcompositionCost = 0;
  let subcompositionLabourHoursPerUnit = 0;
  for (const line of subLines) {
    const child = await computeCompositionUnitCostV2(line.subcompositionId, requestingCompanyId, zoneId, client, [...stack, compositionId], edges);
    const [meta] = await client.select({ name: costCompositions.name }).from(costCompositions).where(eq(costCompositions.id, line.subcompositionId)).limit(1);
    const qty = Number(line.qtyPerUnit); const subtotal = qty * child.unitCost; subcompositionCost += subtotal;
    subcompositionLabourHoursPerUnit += qty * child.labourHoursPerUnit;
    subcompositions.push({ id: line.id, subcompositionId: line.subcompositionId, name: meta?.name ?? "Subcomposição", qtyPerUnit: qty, unitCost: roundCost(child.unitCost), subtotal: roundCost(subtotal) });
  }
  subcompositionCost = roundCost(subcompositionCost);
  const derivedRows = await client.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, compositionId));
  const derived = computeDerivedCosts({ materials: materialCost, labour: labourCost, equipment: equipmentCost, subcompositions: subcompositionCost }, derivedRows.map((row) => ({ id: row.id, name: row.name, basis: row.basis as any, percentage: Number(row.percentage) })));
  const unitCost = roundCost(materialCost + labourCost + equipmentCost + subcompositionCost + derived.total);

  const qualityWarnings: string[] = [];
  const lineCount = facts.labourLines.length + facts.materialLines.length + facts.equipmentLines.length + subLines.length;
  if (!lineCount) qualityWarnings.push("A composição ainda não tem recursos associados.");
  if (!composition.code) qualityWarnings.push("Defina um código para rastrear esta composição.");
  if (!composition.measurementCriteria) qualityWarnings.push("Registe o critério de medição e pagamento.");
  if (!composition.sourceName) qualityWarnings.push("Indique a fonte técnica ou metodologia usada.");
  if (!composition.outputPerDay && !composition.crewSize) qualityWarnings.push("Produtividade ainda não definida; o cronograma usará horas de mão-de-obra/fallback.");
  if (unitCost <= 0) qualityWarnings.push("O custo directo calculado é zero.");
  let qualityScore = 100 - (!lineCount ? 40 : 0) - (!composition.code ? 10 : 0) - (!composition.measurementCriteria ? 15 : 0) - (!composition.sourceName ? 10 : 0) - (!composition.outputPerDay && !composition.crewSize ? 5 : 0) - (unitCost <= 0 ? 25 : 0);
  qualityScore = Math.max(0, qualityScore);

  const labourHoursPerUnit = roundCost(directLabourHoursPerUnit + subcompositionLabourHoursPerUnit);
  const productivity = computeCompositionProductivity({ quantity: 1, outputPerDay: composition.outputPerDay == null ? null : Number(composition.outputPerDay), productiveHoursPerDay: composition.productiveHoursPerDay == null ? null : Number(composition.productiveHoursPerDay), crewSize: composition.crewSize, labourHoursPerUnit });
  return {
    compositionId, labourCost, materialCost, equipmentCost, subcompositionCost, derivedCost: derived.total, labourHoursPerUnit,
    directCost: unitCost, auxiliaryCost: 0, indirectCost: 0, profit: 0, unitCost,
    qualityScore, qualityWarnings, isReady: lineCount > 0 && unitCost > 0 && qualityScore >= 50,
    derivedCostLines: derived.details.map((row) => ({ id: row.id ?? "", name: row.name, basis: row.basis, percentage: row.percentage, base: row.base, amount: row.amount })),
    subcompositions,
    productivity: { crewSize: composition.crewSize ?? null, productiveHoursPerDay: composition.productiveHoursPerDay == null ? null : Number(composition.productiveHoursPerDay), outputPerDay: productivity.outputPerDay, outputPerHour: productivity.outputPerHour, productivitySource: composition.productivitySource ?? null, productivityNotes: composition.productivityNotes ?? null, basis: productivity.basis },
  };
}
