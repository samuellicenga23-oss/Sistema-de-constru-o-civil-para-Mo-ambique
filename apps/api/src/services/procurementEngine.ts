import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  measurementCertificates,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  supplierMaterialPrices,
  suppliers,
  scheduleTasks,
  plants,
  extractedRebarSchedules,
} from "../db/schema.js";
import { computeMaterialsByPhase, computeMaterialsFromCertificate, remainingMaterialQuantity } from "./materialsByPhase.js";
import { mapToPhase } from "./phaseMapping.js";
import { buildRebarPurchasePlan, calculateVatTotals, DEFAULT_REBAR_LENGTH_M, type RebarPurchaseLine } from "@sigo/shared";
import { SIGO_PRICES_SUPPLIER_NAME } from "./sigoPrices.js";
import { assertSupplierMarketplaceAccess } from "./subscriptionEntitlements.js";

export type ProjectRebarPurchasePlan = {
  sourcePlantId: string;
  sourceFileName: string | null;
  commercialBarLengthM: number;
  lines: RebarPurchaseLine[];
  totalScheduledWeightKg: number;
  totalPurchaseWeightKg: number;
};

async function getProjectRebarPurchasePlan(projectId: string): Promise<ProjectRebarPurchasePlan | null> {
  const candidates = await db
    .select({ id: plants.id, originalFileName: plants.originalFileName })
    .from(plants)
    .where(and(eq(plants.projectId, projectId), eq(plants.processingStatus, "concluido")))
    .orderBy(desc(plants.uploadedAt));
  for (const candidate of candidates) {
    const rows = await db
      .select({ diameterMm: extractedRebarSchedules.diameterMm, weightKg: extractedRebarSchedules.weightKg })
      .from(extractedRebarSchedules)
      .where(eq(extractedRebarSchedules.plantId, candidate.id));
    if (!rows.length) continue;
    const lines = buildRebarPurchasePlan(
      rows.map((row) => ({ diameterMm: Number(row.diameterMm), weightKg: Number(row.weightKg) })),
      DEFAULT_REBAR_LENGTH_M,
    );
    return {
      sourcePlantId: candidate.id,
      sourceFileName: candidate.originalFileName,
      commercialBarLengthM: DEFAULT_REBAR_LENGTH_M,
      lines,
      totalScheduledWeightKg: lines.reduce((sum, line) => sum + line.scheduledWeightKg, 0),
      totalPurchaseWeightKg: lines.reduce((sum, line) => sum + line.purchaseWeightKg, 0),
    };
  }
  return null;
}

export type ProcurementRequirement = {
  materialId: string;
  materialName: string;
  unit: string;
  phases: { key: string; label: string; quantity: number }[];
  designQty: number;
  executedQty: number;
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
  supplierContact: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  quotes: ProcurementQuote[];
  suggestedScheduleTaskId: string | null;
  suggestedScheduleTaskName: string | null;
  requiredByDate: string | null;
};

export type ProcurementQuote = {
  supplierId: string | null;
  supplierName: string;
  supplierContact: string | null;
  unitCost: number;
  estimatedSubtotal: number;
  estimatedVat: number;
  estimatedTotalWithVat: number;
  currency: string;
  zoneId: string | null;
  quoteSource: "zona" | "geral" | "catalogo";
  isReference: boolean;
};

export function rankProcurementQuotes<T extends { zoneId: string | null; unitCost: string | number }>(quotes: T[], zoneId: string | null): T[] {
  return [...quotes].sort((left, right) => {
    const leftZone = zoneId !== null && left.zoneId === zoneId;
    const rightZone = zoneId !== null && right.zoneId === zoneId;
    if (leftZone !== rightZone) return leftZone ? -1 : 1;
    return Number(left.unitCost) - Number(right.unitCost);
  });
}

export function calculateProcurementQuantity(args: { requiredQty: number; consumedQty: number; stockQty: number; orderedQty: number; packageSize?: number | null }) {
  const shortageQty = Math.max(0, args.requiredQty - args.consumedQty - Math.max(0, args.stockQty) - args.orderedQty);
  const suggestedOrderQty = args.packageSize ? Math.ceil(shortageQty / args.packageSize) * args.packageSize : shortageQty;
  return { shortageQty, suggestedOrderQty };
}

// Transforma o BOQ em necessidades de compra, descontando o que o último Auto aprovado
// já certificou (acumulado × composição): saldo restante = max(0, projecto − executado).
// Stock e encomendas abertas cobrem esse saldo; saídas de armazém não voltam a abater o saldo,
// porque o Auto acumulado já representa o trabalho executado.
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
  const rebarPurchasePlan = await getProjectRebarPurchasePlan(args.projectId);

  const [latestApproved] = await db
    .select({ id: measurementCertificates.id, number: measurementCertificates.number, periodDate: measurementCertificates.periodDate })
    .from(measurementCertificates)
    .where(and(
      eq(measurementCertificates.budgetDocumentId, args.documentId),
      eq(measurementCertificates.status, "aprovado"),
    ))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);
  const executedByMaterial = latestApproved
    ? await computeMaterialsFromCertificate(latestApproved.id, args.companyId, "cumulativeQty")
    : new Map<string, { quantity: number; value: number; name: string; unit: string; purchasePackageLabel: string | null; purchasePackageQty: number | null }>();

  type RequiredBucket = {
    materialId: string;
    materialName: string;
    unit: string;
    designQty: number;
    executedQty: number;
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
        designQty: 0,
        executedQty: 0,
        requiredQty: 0,
        catalogValue: 0,
        purchasePackageLabel: line.purchasePackageLabel,
        packageSize: line.purchasePackageQty,
        phases: [],
      };
      current.designQty += line.quantity;
      current.catalogValue += line.value;
      current.phases.push({ key: phase.key, label: phase.label, quantity: line.quantity });
      required.set(line.materialId, current);
    }
  }
  for (const [materialId, bucket] of required) {
    const executedQty = executedByMaterial.get(materialId)?.quantity ?? 0;
    bucket.executedQty = executedQty;
    bucket.requiredQty = remainingMaterialQuantity(bucket.designQty, executedQty);
    required.set(materialId, bucket);
  }

  const materialIds = Array.from(required.keys());
  if (!materialIds.length) {
    return {
      documentId: args.documentId,
      currency: args.currency,
      ivaRate: args.ivaRate,
      quantityBasis: "remaining" as const,
      sourceCertificate: latestApproved ? { id: latestApproved.id, number: latestApproved.number, periodDate: latestApproved.periodDate } : null,
      requiredValue: 0,
      shortageValue: 0,
      shortageVat: 0,
      shortageTotal: 0,
      coveragePercent: 0,
      requirements: [],
      rebarPurchasePlan,
      missingCompositionItems: phaseReport.phases.flatMap((phase) => phase.itemsWithoutComposition.map((item) => ({ ...item, phase: phase.label }))),
    };
  }

  // Preços do marketplace nacional (fornecedores reais, companyId null) só entram no plano de
  // compras se a empresa tiver acesso (plano Profissional) — mesmo gate do resto do marketplace.
  const marketplaceAllowed = !(await assertSupplierMarketplaceAccess(args.companyId));

  const [movementRows, orderRows, rawQuoteRows, taskRows] = await Promise.all([
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
        supplierContact: suppliers.contact,
        zoneId: supplierMaterialPrices.zoneId,
        unitCost: supplierMaterialPrices.unitCost,
        currency: supplierMaterialPrices.currency,
        supplierCompanyId: suppliers.companyId,
        supplierZoneId: suppliers.zoneId,
      })
      .from(supplierMaterialPrices)
      .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
      .where(and(
        marketplaceAllowed ? or(eq(suppliers.companyId, args.companyId), isNull(suppliers.companyId)) : eq(suppliers.companyId, args.companyId),
        inArray(supplierMaterialPrices.materialId, materialIds),
        eq(supplierMaterialPrices.currency, args.currency as "MZN" | "USD"),
      )),
    db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId)),
  ]);
  taskRows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const summaryTaskIds = new Set(taskRows.filter((task) => task.parentId).map((task) => task.parentId!));

  // Um fornecedor do marketplace não tem cotação "por zona" (o preço é sempre geral) — a zona é
  // a que ele indicou no registo. Normaliza aqui para o resto do motor (ranking, agrupamento)
  // continuar a raciocinar só sobre um único `zoneId` por cotação, como já fazia.
  const quoteRows = rawQuoteRows
    .filter((row) => (row.supplierCompanyId === null ? row.zoneId === null : true))
    .map((row) => ({
      materialId: row.materialId,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      supplierContact: row.supplierContact,
      unitCost: row.unitCost,
      currency: row.currency,
      zoneId: row.supplierCompanyId === null ? row.supplierZoneId : row.zoneId,
    }))
    .filter((row) => (args.zoneId ? row.zoneId === null || row.zoneId === args.zoneId : row.zoneId === null));

  const stock = new Map<string, number>();
  const consumed = new Map<string, number>();
  for (const movement of movementRows) {
    const qty = Number(movement.quantity);
    stock.set(movement.materialId, (stock.get(movement.materialId) ?? 0) + (movement.type === "entrada" ? qty : -qty));
    if (movement.type === "saida") consumed.set(movement.materialId, (consumed.get(movement.materialId) ?? 0) + qty);
  }
  const ordered = new Map<string, number>();
  for (const row of orderRows) ordered.set(row.line.materialId, (ordered.get(row.line.materialId) ?? 0) + Number(row.line.quantity));

  const quotesByMaterial = new Map<string, Map<string, (typeof quoteRows)[number]>>();
  for (const quote of quoteRows) {
    const materialQuotes = quotesByMaterial.get(quote.materialId) ?? new Map<string, (typeof quoteRows)[number]>();
    const current = materialQuotes.get(quote.supplierId);
    const quoteIsZone = quote.zoneId === args.zoneId && args.zoneId !== null;
    const currentIsZone = current?.zoneId === args.zoneId && args.zoneId !== null;
    if (!current || (quoteIsZone && !currentIsZone) || (quoteIsZone === currentIsZone && Number(quote.unitCost) < Number(current.unitCost))) {
      materialQuotes.set(quote.supplierId, quote);
      quotesByMaterial.set(quote.materialId, materialQuotes);
    }
  }

  const requirements: ProcurementRequirement[] = Array.from(required.values()).map((item) => {
    const stockQty = stock.get(item.materialId) ?? 0;
    const consumedQty = consumed.get(item.materialId) ?? 0;
    const orderedQty = ordered.get(item.materialId) ?? 0;
    // Saldo restante já desconta o Auto acumulado; stock + OC abertos cobrem o que falta comprar
    // para o trabalho por executar. Saídas de armazém não voltam a reduzir este saldo.
    const { shortageQty, suggestedOrderQty } = calculateProcurementQuantity({
      requiredQty: item.requiredQty,
      consumedQty: 0,
      stockQty,
      orderedQty,
      packageSize: item.packageSize,
    });
    const availableQuotes = Array.from(quotesByMaterial.get(item.materialId)?.values() ?? []);
    // SIGO Preços compete em igualdade com fornecedores comerciais — pode ser escolhido para OC.
    const rankedQuotes = rankProcurementQuotes(availableQuotes, args.zoneId);
    const quote = rankedQuotes[0];
    const quoteIsSigo = quote?.supplierName === SIGO_PRICES_SUPPLIER_NAME;
    const catalogUnitCost = item.designQty > 0 ? item.catalogValue / item.designQty : 0;
    const estimatedUnitCost = quote ? Number(quote.unitCost) : catalogUnitCost;
    const quoteSource: ProcurementRequirement["quoteSource"] = !quote
      ? "catalogo"
      : quote.zoneId
        ? "zona"
        : quoteIsSigo
          ? "catalogo"
          : "geral";
    const phaseKeys = new Set(item.phases.map((phase) => phase.key));
    const matchingTasks = taskRows.filter((task) => phaseKeys.has(mapToPhase(task.name, [], task.name)));
    const suggestedTask = matchingTasks.find((task) => !summaryTaskIds.has(task.id)) ?? matchingTasks[0];
    const estimate = calculateVatTotals(suggestedOrderQty * estimatedUnitCost, args.ivaRate);
    const quotes: ProcurementQuote[] = rankedQuotes.map((candidate) => {
      const totals = calculateVatTotals(suggestedOrderQty * Number(candidate.unitCost), args.ivaRate);
      const isSigo = candidate.supplierName === SIGO_PRICES_SUPPLIER_NAME;
      return {
        supplierId: candidate.supplierId,
        supplierName: candidate.supplierName,
        supplierContact: candidate.supplierContact,
        unitCost: Number(candidate.unitCost),
        estimatedSubtotal: totals.subtotal,
        estimatedVat: totals.iva,
        estimatedTotalWithVat: totals.total,
        currency: candidate.currency,
        zoneId: candidate.zoneId,
        quoteSource: candidate.zoneId ? "zona" : isSigo ? "catalogo" : "geral",
        // Mantido para a UI (badge); já não bloqueia a criação de ordem de compra.
        isReference: isSigo,
      };
    });
    return {
      materialId: item.materialId,
      materialName: item.materialName,
      unit: item.unit,
      phases: item.phases,
      designQty: item.designQty,
      executedQty: item.executedQty,
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
      supplierContact: quote?.supplierContact ?? null,
      quoteSource,
      quotes,
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
    quantityBasis: "remaining" as const,
    sourceCertificate: latestApproved ? { id: latestApproved.id, number: latestApproved.number, periodDate: latestApproved.periodDate } : null,
    requiredValue: requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0),
    shortageValue,
    shortageVat: shortageTotals.iva,
    shortageTotal: shortageTotals.total,
    coveragePercent: requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0)
      ? Math.max(0, Math.min(100, (requirements.reduce((sum, item) => sum + Math.min(item.requiredQty, Math.max(0, item.stockQty) + item.orderedQty) * item.estimatedUnitCost, 0) / requirements.reduce((sum, item) => sum + item.requiredQty * item.estimatedUnitCost, 0)) * 100))
      : 100,
    requirements,
    rebarPurchasePlan,
    missingCompositionItems: phaseReport.phases.flatMap((phase) => phase.itemsWithoutComposition.map((item) => ({ ...item, phase: phase.label }))),
  };
}
