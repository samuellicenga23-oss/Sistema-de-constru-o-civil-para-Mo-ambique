import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  supplierMaterialPrices,
  suppliers,
  scheduleTasks,
} from "../db/schema.js";
import { computeMaterialsByPhase } from "./materialsByPhase.js";
import { mapToPhase } from "./phaseMapping.js";
import { calculateVatTotals } from "@sigo/shared";

export type ProcurementRequirement = {
  materialId: string;
  materialName: string;
  unit: string;
  phases: { key: string; label: string; quantity: number }[];
  requiredQty: number;
  stockQty: number;
  consumedQty: number;
  orderedQty: number;
  shortageQty: number;
  suggestedOrderQty: number;
  purchaseQty: number | null;
  purchasePackageLabel: string | null;
  estimatedUnitCost: number;
  estimatedTotal: number;
  estimatedVat: number;
  estimatedTotalWithVat: number;
  supplierId: string | null;
  supplierName: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  suggestedScheduleTaskId: string | null;
  suggestedScheduleTaskName: string | null;
  requiredByDate: string | null;
};

export function calculateProcurementQuantity(args: { requiredQty: number; consumedQty: number; stockQty: number; orderedQty: number; packageSize?: number | null }) {
  const shortageQty = Math.max(0, args.requiredQty - args.consumedQty - Math.max(0, args.stockQty) - args.orderedQty);
  const suggestedOrderQty = args.packageSize ? Math.ceil(shortageQty / args.packageSize) * args.packageSize : shortageQty;
  return { shortageQty, suggestedOrderQty };
}

// Transforma as composições do Mapa de Quantidades num plano de aprovisionamento real: total
// necessário - stock disponível - encomendas ainda abertas. As cotações da zona da obra têm
// prioridade; entre fornecedores equivalentes vence o menor preço. O catálogo só é fallback.
export async function computeProcurementPlan(args: {
  projectId: string;
  documentId: string;
  companyId: string;
  zoneId: string | null;
  currency: string;
  ivaRate: number;
}) {
  const phaseReport = await computeMaterialsByPhase(args.documentId, args.companyId);
  if (!phaseReport) return null;

  type RequiredBucket = {
    materialId: string;
    materialName: string;
    unit: string;
    requiredQty: number;
    catalogValue: number;
    purchasePackageLabel: string | null;
    packageSize: number | null;
    phases: { key: string; label: string; quantity: number }[];
  };
  const required = new Map<string, RequiredBucket>();
  for (const phase of phaseReport.phases) {
    for (const line of phase.materials) {
      if (!line.materialId) continue;
      const current = required.get(line.materialId) ?? {
        materialId: line.materialId,
        materialName: line.name,
        unit: line.unit,
        requiredQty: 0,
        catalogValue: 0,
        purchasePackageLabel: line.purchasePackageLabel,
        packageSize: line.purchasePackageQty,
        phases: [],
      };
      current.requiredQty += line.quantity;
      current.catalogValue += line.value;
      current.phases.push({ key: phase.key, label: phase.label, quantity: line.quantity });
      required.set(line.materialId, current);
    }
  }

  const materialIds = Array.from(required.keys());
  if (!materialIds.length) {
    return {
      documentId: args.documentId,
      currency: args.currency,
      ivaRate: args.ivaRate,
      requiredValue: 0,
      shortageValue: 0,
      shortageVat: 0,
      shortageTotal: 0,
      coveragePercent: 0,
      requirements: [],
      missingCompositionItems: phaseReport.phases.flatMap((phase) => phase.itemsWithoutComposition.map((item) => ({ ...item, phase: phase.label }))),
    };
  }

  const [movementRows, orderRows, quoteRows, taskRows] = await Promise.all([
    db.select().from(stockMovements).where(and(eq(stockMovements.projectId, args.projectId), inArray(stockMovements.materialId, materialIds))),
    db
      .select({ order: purchaseOrders, line: purchaseOrderLines })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .where(and(eq(purchaseOrders.projectId, args.projectId), inArray(purchaseOrderLines.materialId, materialIds), inArray(purchaseOrders.status, ["rascunho", "aprovado"]))),
    db
      .select({
        materialId: supplierMaterialPrices.materialId,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        zoneId: supplierMaterialPrices.zoneId,
        unitCost: supplierMaterialPrices.unitCost,
        currency: supplierMaterialPrices.currency,
      })
      .from(supplierMaterialPrices)
      .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
      .where(and(
        eq(suppliers.companyId, args.companyId),
        inArray(supplierMaterialPrices.materialId, materialIds),
        eq(supplierMaterialPrices.currency, args.currency as "MZN" | "USD"),
        args.zoneId ? or(isNull(supplierMaterialPrices.zoneId), eq(supplierMaterialPrices.zoneId, args.zoneId)) : isNull(supplierMaterialPrices.zoneId)
      )),
    db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId)),
  ]);
  taskRows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const summaryTaskIds = new Set(taskRows.filter((task) => task.parentId).map((task) => task.parentId!));

  const stock = new Map<string, number>();
  const consumed = new Map<string, number>();
  for (const movement of movementRows) {
    const qty = Number(movement.quantity);
    stock.set(movement.materialId, (stock.get(movement.materialId) ?? 0) + (movement.type === "entrada" ? qty : -qty));
    if (movement.type === "saida") consumed.set(movement.materialId, (consumed.get(movement.materialId) ?? 0) + qty);
  }
  const ordered = new Map<string, number>();
  for (const row of orderRows) ordered.set(row.line.materialId, (ordered.get(row.line.materialId) ?? 0) + Number(row.line.quantity));

  const bestQuote = new Map<string, (typeof quoteRows)[number]>();
  for (const quote of quoteRows) {
    const current = bestQuote.get(quote.materialId);
    const quoteIsZone = quote.zoneId === args.zoneId && args.zoneId !== null;
    const currentIsZone = current?.zoneId === args.zoneId && args.zoneId !== null;
    if (!current || (quoteIsZone && !currentIsZone) || (quoteIsZone === currentIsZone && Number(quote.unitCost) < Number(current.unitCost))) {
      bestQuote.set(quote.materialId, quote);
    }
  }

  const requirements: ProcurementRequirement[] = Array.from(required.values()).map((item) => {
    const stockQty = stock.get(item.materialId) ?? 0;
    const consumedQty = consumed.get(item.materialId) ?? 0;
    const orderedQty = ordered.get(item.materialId) ?? 0;
    // O consumo registado no Diario ja executou parte da necessidade. Sem o abater,
    // cada saida de armazem voltaria a aparecer como uma nova compra e duplicaria o custo.
    const { shortageQty, suggestedOrderQty } = calculateProcurementQuantity({ requiredQty: item.requiredQty, consumedQty, stockQty, orderedQty, packageSize: item.packageSize });
    const quote = bestQuote.get(item.materialId);
    const catalogUnitCost = item.requiredQty > 0 ? item.catalogValue / item.requiredQty : 0;
    const estimatedUnitCost = quote ? Number(quote.unitCost) : catalogUnitCost;
    const quoteSource: ProcurementRequirement["quoteSource"] = quote ? (quote.zoneId ? "zona" : "geral") : "catalogo";
    const phaseKeys = new Set(item.phases.map((phase) => phase.key));
    const matchingTasks = taskRows.filter((task) => phaseKeys.has(mapToPhase(task.name, [], task.name)));
    const suggestedTask = matchingTasks.find((task) => !summaryTaskIds.has(task.id)) ?? matchingTasks[0];
    const estimate = calculateVatTotals(suggestedOrderQty * estimatedUnitCost, args.ivaRate);
    return {
      materialId: item.materialId,
      materialName: item.materialName,
      unit: item.unit,
      phases: item.phases,
      requiredQty: item.requiredQty,
      stockQty,
      consumedQty,
      orderedQty,
      shortageQty,
      suggestedOrderQty,
      purchaseQty: item.packageSize ? Math.ceil(suggestedOrderQty / item.packageSize) : null,
      purchasePackageLabel: item.purchasePackageLabel,
      estimatedUnitCost,
      estimatedTotal: estimate.subtotal,
      estimatedVat: estimate.iva,
      estimatedTotalWithVat: estimate.total,
      supplierId: quote?.supplierId ?? null,
      supplierName: quote?.supplierName ?? null,
      quoteSource,
      suggestedScheduleTaskId: suggestedTask?.id ?? null,
      suggestedScheduleTaskName: suggestedTask?.name ?? null,
      requiredByDate: suggestedTask?.startDate ?? null,
    };
  }).sort((a, b) => b.shortageQty * b.estimatedUnitCost - a.shortageQty * a.estimatedUnitCost);

  const shortageValue = requirements.reduce((sum, item) => sum + item.estimatedTotal, 0);
  const shortageTotals = calculateVatTotals(shortageValue, args.ivaRate);
  return {
    documentId: args.documentId,
    currency: args.currency,
    ivaRate: args.ivaRate,
    requiredValue: requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0),
    shortageValue,
    shortageVat: shortageTotals.iva,
    shortageTotal: shortageTotals.total,
    coveragePercent: requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0)
      ? Math.max(0, Math.min(100, (requirements.reduce((sum, item) => sum + Math.min(item.requiredQty, item.consumedQty + Math.max(0, item.stockQty) + item.orderedQty) * item.estimatedUnitCost, 0) / requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0)) * 100))
      : 100,
    requirements,
    missingCompositionItems: phaseReport.phases.flatMap((phase) => phase.itemsWithoutComposition.map((item) => ({ ...item, phase: phase.label }))),
  };
}
