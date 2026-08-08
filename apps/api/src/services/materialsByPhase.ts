import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, lineItems, projects } from "../db/schema.js";
import { DEFAULT_REBAR_LENGTH_M, rebarWeightPerMeter } from "@sigo/shared";
import { getBudgetDocumentSummary, type LineItemNode } from "./boqEngine.js";
import { getCompositionMaterialQuantitiesV2 as getCompositionMaterialQuantities, type CompositionMaterialQuantityLineV2 } from "./costEngineV2.js";
import { getCertificateDetail } from "./measurementEngine.js";
import { listLineItemCostSnapshots } from "./costSnapshotService.js";
import { CONSTRUCTION_PHASES, mapToPhase, phaseLabel, type PhaseKey } from "./phaseMapping.js";

// Uma vez aprovado/gerado o item, o custo fica congelado num snapshot (ver costSnapshotService)
// exactamente para o Auto de medição, o BOQ e o relatório de materiais nunca se desalinharem
// depois de o utilizador editar preços/receitas no Catálogo. Antes desta função, este ficheiro
// lia sempre a composição AO VIVO, pelo que "materiais por fase" e "saldo de compras" podiam
// divergir silenciosamente do valor já certificado ao cliente — corrigido lendo o snapshot mais
// recente da própria linha quando existe, e só recorrendo à composição ao vivo quando não há
// snapshot ainda (documento em rascunho, nunca aprovado/reprecificado).
async function resolveMaterialQuantities(
  lineItemId: string,
  compositionId: string,
  companyId: string | null,
  zoneId: string | null,
): Promise<CompositionMaterialQuantityLineV2[]> {
  const snapshots = await listLineItemCostSnapshots(lineItemId);
  const latest = snapshots[0];
  if (latest?.resourceSnapshot?.materials?.length) {
    return latest.resourceSnapshot.materials.map((line: any) => ({
      materialId: line.materialId,
      familyKey: line.familyKey,
      name: line.name,
      unit: line.unit,
      qtyPerUnit: line.qtyPerUnit,
      baseQtyPerUnit: line.qtyPerUnit,
      wastePct: 0,
      unitCost: line.unitCost,
      currency: line.currency,
      purchasePackageLabel: null,
      purchasePackageQty: null,
    }));
  }
  return getCompositionMaterialQuantities(compositionId, companyId, zoneId);
}

export type PhaseMaterialLine = {
  materialId: string;
  name: string;
  unit: string;
  quantity: number;
  value: number;
  currency: string;
  // Quantidade a encomendar na unidade de compra de mercado (ex: 3 camiões), arredondada sempre
  // para cima — null quando o material não tem embalagem de compra definida no Catálogo (mostra-
  // se apenas na unidade de medida).
  purchaseQty: number | null;
  purchasePackageLabel: string | null;
  purchasePackageQty: number | null;
};

export type SteelBarInfo = { diameterMm: number; lengthM: number; barLengthM: number; barsNeeded: number };

export type PhaseUnmappedItem = {
  code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  value: number;
  barsInfo: SteelBarInfo | null;
};

export type PhaseReport = {
  key: PhaseKey;
  label: string;
  materials: PhaseMaterialLine[];
  itemsWithoutComposition: PhaseUnmappedItem[];
  valueTotal: number;
};

export type MaterialsByPhaseResult = { phases: PhaseReport[]; currency: string; grandTotal: number };

// Itens de aço sem composição associada costumam vir de ficheiros reais importados, discriminados
// por diâmetro na própria descrição (ex: "Ø6mm", "Ø 10 mm") — quando isso acontece (e a unidade é
// kg), dá para converter a quantidade em metros lineares e nº de varões a comprar, tal como já se
// faz na calculadora "Laje". Composições genéricas (ex: "Aço A400 aplicado") não têm este detalhe
// porque misturam vários diâmetros num só "kg aplicado" — por isso não se tenta a mesma conversão
// para as linhas resolvidas por composição, só para estes itens manuais com diâmetro no texto.
function detectSteelBarInfo(description: string, unit: string | null, quantityKg: number): SteelBarInfo | null {
  if (unit !== "kg") return null;
  const match = description.match(/Ø\s*(\d+(?:[.,]\d+)?)\s*mm/i);
  if (!match) return null;
  const diameterMm = Number(match[1].replace(",", "."));
  if (!(diameterMm > 0) || !(quantityKg > 0)) return null;
  const weightPerMeter = rebarWeightPerMeter(diameterMm);
  const lengthM = quantityKg / weightPerMeter;
  return {
    diameterMm,
    lengthM,
    barLengthM: DEFAULT_REBAR_LENGTH_M,
    barsNeeded: Math.ceil(lengthM / DEFAULT_REBAR_LENGTH_M),
  };
}

async function getProjectZoneId(documentId: string): Promise<string | null> {
  const [row] = await db
    .select({ zoneId: projects.zoneId })
    .from(budgetDocuments)
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(eq(budgetDocuments.id, documentId))
    .limit(1);
  return row?.zoneId ?? null;
}

// Explode o Mapa de Quantidades já medido em materiais reais, agrupados por fase de obra: para
// cada item com quantidade > 0 e composição associada, soma quantidade × qtyPerUnit de cada
// material da composição (resolvido por familyKey + preço de zona, costEngineV2) na fase
// a que o capítulo/palavras-chave do item pertence (ver phaseMapping.ts), e soma também o VALOR
// (quantidade × custo unitário do material). Itens sem composição (preço manual) não têm como ser
// explodidos em materiais — ficam listados à parte, por fase, com o seu próprio valor (quantidade
// × preço unitário já gravado no item) para não desaparecerem silenciosamente do relatório; se
// forem de aço com diâmetro identificável na descrição, ganham também nº de varões a comprar.
export async function computeMaterialsByPhase(documentId: string, companyId: string | null): Promise<MaterialsByPhaseResult | null> {
  const summary = await getBudgetDocumentSummary(documentId);
  if (!summary) return null;
  const zoneId = await getProjectZoneId(documentId);

  type MaterialBucket = {
    materialId: string;
    familyKey: string;
    name: string;
    unit: string;
    quantity: number;
    value: number;
    currency: string;
    purchasePackageLabel: string | null;
    purchasePackageQty: number | null;
  };
  const materialTotals = new Map<PhaseKey, Map<string, MaterialBucket>>();
  const unmapped = new Map<PhaseKey, PhaseUnmappedItem[]>();
  const compositionQtyCache = new Map<string, Awaited<ReturnType<typeof getCompositionMaterialQuantities>>>();

  function ensurePhase(key: PhaseKey) {
    if (!materialTotals.has(key)) materialTotals.set(key, new Map());
    if (!unmapped.has(key)) unmapped.set(key, []);
  }

  async function walk(node: LineItemNode, ancestorDescriptions: string[]) {
    const nextAncestors =
      node.kind === "capitulo" || node.kind === "grupo" ? [...ancestorDescriptions, node.description] : ancestorDescriptions;

    if (node.kind === "item" && (node.quantity ?? 0) > 0) {
      const chapterName = ancestorDescriptions[0] ?? node.description;
      const phaseKey = mapToPhase(chapterName, ancestorDescriptions, node.description);
      ensurePhase(phaseKey);
      const quantity = node.quantity ?? 0;

      if (node.compositionId) {
        // Cache por LINHA (não por composição): duas linhas com a mesma composição podem ter
        // snapshots congelados em momentos diferentes, por isso não podem partilhar resultado.
        if (!compositionQtyCache.has(node.id)) {
          compositionQtyCache.set(node.id, await resolveMaterialQuantities(node.id, node.compositionId, companyId, zoneId));
        }
        const lines = compositionQtyCache.get(node.id)!;
        const bucket = materialTotals.get(phaseKey)!;
        for (const line of lines) {
          const addQty = line.qtyPerUnit * quantity;
          const addValue = addQty * line.unitCost;
          const key = line.familyKey || line.materialId;
          const existing = bucket.get(key);
          if (existing) {
            existing.quantity += addQty;
            existing.value += addValue;
            existing.materialId = line.materialId || existing.materialId;
            existing.name = line.name || existing.name;
          } else {
            bucket.set(key, {
              materialId: line.materialId,
              familyKey: line.familyKey,
              name: line.name,
              unit: line.unit,
              quantity: addQty,
              value: addValue,
              currency: line.currency,
              purchasePackageLabel: line.purchasePackageLabel,
              purchasePackageQty: line.purchasePackageQty,
            });
          }
        }
      } else {
        unmapped.get(phaseKey)!.push({
          code: node.code,
          description: node.description,
          quantity,
          unit: node.unit,
          value: quantity * (node.unitPrice ?? 0),
          barsInfo: detectSteelBarInfo(node.description, node.unit, quantity),
        });
      }
    }

    for (const child of node.children) await walk(child, nextAncestors);
  }

  for (const section of summary.sections) {
    for (const root of section.items) await walk(root, []);
  }

  let grandTotal = 0;
  const phases = CONSTRUCTION_PHASES.map((p) => {
    const materials = Array.from(materialTotals.get(p.key)?.values() ?? [])
      .map((v) => ({
        materialId: v.materialId,
        name: v.name,
        unit: v.unit,
        quantity: v.quantity,
        value: v.value,
        currency: v.currency,
        purchaseQty: v.purchasePackageQty ? Math.ceil(v.quantity / v.purchasePackageQty) : null,
        purchasePackageLabel: v.purchasePackageLabel,
        purchasePackageQty: v.purchasePackageQty,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const itemsWithoutComposition = unmapped.get(p.key) ?? [];
    const valueTotal = materials.reduce((sum, m) => sum + m.value, 0) + itemsWithoutComposition.reduce((sum, i) => sum + i.value, 0);
    grandTotal += valueTotal;
    return { key: p.key, label: phaseLabel(p.key), materials, itemsWithoutComposition, valueTotal };
  }).filter((p) => p.materials.length > 0 || p.itemsWithoutComposition.length > 0);

  return { phases, currency: summary.document.currency, grandTotal };
}

/** Quantidades teóricas de material derivadas das medições de um Auto (período ou acumulado). */
export async function computeMaterialsFromCertificate(
  certificateId: string,
  companyId: string,
  qtyField: "periodQty" | "cumulativeQty" = "cumulativeQty",
): Promise<Map<string, { quantity: number; value: number; name: string; unit: string; purchasePackageLabel: string | null; purchasePackageQty: number | null }>> {
  const byMaterialId = new Map<string, { quantity: number; value: number; name: string; unit: string; purchasePackageLabel: string | null; purchasePackageQty: number | null }>();
  const detail = await getCertificateDetail(certificateId);
  if (!detail) return byMaterialId;

  const [context] = await db
    .select({ zoneId: projects.zoneId, projectCompanyId: projects.companyId })
    .from(projects)
    .where(eq(projects.id, detail.certificate.projectId))
    .limit(1);
  if (!context || context.projectCompanyId !== companyId) return byMaterialId;

  const itemIds = detail.lines.map((line) => line.lineItemId);
  if (!itemIds.length) return byMaterialId;
  const itemRows = await db.select({ id: lineItems.id, compositionId: lineItems.compositionId }).from(lineItems).where(inArray(lineItems.id, itemIds));
  const compositionByItem = new Map(itemRows.map((row) => [row.id, row.compositionId]));
  const cache = new Map<string, Awaited<ReturnType<typeof getCompositionMaterialQuantities>>>();
  const familyBuckets = new Map<string, { materialId: string; quantity: number; value: number; name: string; unit: string; purchasePackageLabel: string | null; purchasePackageQty: number | null }>();

  for (const line of detail.lines) {
    const measuredQty = qtyField === "periodQty" ? line.periodQty : line.cumulativeQty;
    if (!(measuredQty > 0)) continue;
    const compositionId = compositionByItem.get(line.lineItemId);
    if (!compositionId) continue;
    if (!cache.has(line.lineItemId)) {
      cache.set(line.lineItemId, await resolveMaterialQuantities(line.lineItemId, compositionId, companyId, context.zoneId));
    }
    for (const resource of cache.get(line.lineItemId)!) {
      if (!resource.materialId) continue;
      const addQty = resource.qtyPerUnit * measuredQty;
      const addValue = addQty * resource.unitCost;
      const key = resource.familyKey || resource.materialId;
      const existing = familyBuckets.get(key);
      if (existing) {
        existing.quantity += addQty;
        existing.value += addValue;
        existing.materialId = resource.materialId || existing.materialId;
        existing.name = resource.name || existing.name;
      } else {
        familyBuckets.set(key, {
          materialId: resource.materialId,
          quantity: addQty,
          value: addValue,
          name: resource.name,
          unit: resource.unit,
          purchasePackageLabel: resource.purchasePackageLabel,
          purchasePackageQty: resource.purchasePackageQty,
        });
      }
    }
  }

  for (const row of familyBuckets.values()) {
    const current = byMaterialId.get(row.materialId);
    if (current) {
      current.quantity += row.quantity;
      current.value += row.value;
      current.name = row.name;
    } else {
      byMaterialId.set(row.materialId, {
        quantity: row.quantity,
        value: row.value,
        name: row.name,
        unit: row.unit,
        purchasePackageLabel: row.purchasePackageLabel,
        purchasePackageQty: row.purchasePackageQty,
      });
    }
  }
  return byMaterialId;
}

/** Saldo de materiais do projecto ainda por executar: max(0, BOQ − Auto acumulado). */
export function remainingMaterialQuantity(designQty: number, executedQty: number) {
  return Math.max(0, designQty - executedQty);
}

