import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetSections,
  budgetDocuments,
  lineItems,
  measurementCertificateFieldLines,
  measurementCertificateLines,
  measurementCertificates,
} from "../db/schema.js";
import { calculateBudgetTotals } from "./budgetTotals.js";
import { technicalDescription } from "./technicalDescriptions.js";

async function getLeafItemIds(budgetDocumentId: string): Promise<string[]> {
  const sections = await db.select({ id: budgetSections.id }).from(budgetSections).where(eq(budgetSections.documentId, budgetDocumentId));
  const sectionIds = sections.map((section) => section.id);
  if (!sectionIds.length) return [];
  return (await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(inArray(lineItems.sectionId, sectionIds), eq(lineItems.kind, "item"))))
    .map((item) => item.id);
}

// O acumulado de um novo auto parte exclusivamente do último auto APROVADO. Rascunhos e autos
// submetidos nunca alteram a execução oficial da obra nem contaminam o cronograma/financeiro.
async function getPreviousCumulativeByItem(budgetDocumentId: string, beforeNumber: number): Promise<Map<string, number>> {
  const [previous] = await db
    .select()
    .from(measurementCertificates)
    .where(and(
      eq(measurementCertificates.budgetDocumentId, budgetDocumentId),
      lt(measurementCertificates.number, beforeNumber),
      eq(measurementCertificates.status, "aprovado")
    ))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);
  const result = new Map<string, number>();
  if (!previous) return result;
  for (const line of await db.select().from(measurementCertificateLines).where(eq(measurementCertificateLines.certificateId, previous.id))) {
    result.set(line.lineItemId, Number(line.cumulativeQty));
  }
  return result;
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export async function createMeasurementCertificate(args: {
  projectId: string;
  budgetDocumentId: string;
  periodDate: string;
  periodStartDate?: string;
  notes?: string;
}) {
  const [latest] = await db
    .select()
    .from(measurementCertificates)
    .where(eq(measurementCertificates.budgetDocumentId, args.budgetDocumentId))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);
  if (latest && latest.status !== "aprovado") {
    throw new Error(`Conclua o Auto n.º ${latest.number} antes de abrir um novo período`);
  }
  if (latest && args.periodDate <= latest.periodDate) {
    throw new Error(`A data final deve ser posterior a ${latest.periodDate}`);
  }

  const number = (latest?.number ?? 0) + 1;
  const periodStartDate = args.periodStartDate ?? (latest ? nextDate(latest.periodDate) : undefined);
  if (periodStartDate && periodStartDate > args.periodDate) throw new Error("A data inicial não pode ser posterior à data final");
  const [certificate] = await db
    .insert(measurementCertificates)
    .values({ ...args, number, periodStartDate })
    .returning();

  const itemIds = await getLeafItemIds(args.budgetDocumentId);
  const previousByItem = await getPreviousCumulativeByItem(args.budgetDocumentId, number);
  if (itemIds.length) {
    await db.insert(measurementCertificateLines).values(itemIds.map((lineItemId) => ({
      certificateId: certificate.id,
      lineItemId,
      cumulativeQty: (previousByItem.get(lineItemId) ?? 0).toString(),
      periodQty: "0",
    })));
  }
  return certificate;
}

export function validateMeasuredQuantity(args: {
  previousQty: number;
  periodQty: number;
  budgetedQty: number | null;
  overrunReason?: string | null;
}) {
  if (!Number.isFinite(args.periodQty) || args.periodQty < 0) throw new Error("A quantidade deste período deve ser positiva ou zero");
  const cumulativeQty = args.previousQty + args.periodQty;
  const overrunQty = args.budgetedQty === null ? 0 : Math.max(0, cumulativeQty - args.budgetedQty);
  if (overrunQty > 0.0001 && !args.overrunReason?.trim()) {
    throw new Error(`A medição excede o contratado em ${overrunQty.toFixed(2)}; indique a justificação do trabalho adicional`);
  }
  return { cumulativeQty, overrunQty };
}

export async function updateCertificateLinePeriod(
  certificateLineId: string,
  input: { periodQty: number; notes?: string | null; overrunReason?: string | null }
) {
  const [row] = await db
    .select({ line: measurementCertificateLines, certificate: measurementCertificates, budgetedQty: lineItems.quantity })
    .from(measurementCertificateLines)
    .innerJoin(measurementCertificates, eq(measurementCertificateLines.certificateId, measurementCertificates.id))
    .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
    .where(eq(measurementCertificateLines.id, certificateLineId))
    .limit(1);
  if (!row) throw new Error("Linha de medição não encontrada");
  if (row.certificate.status !== "rascunho") throw new Error("Só é possível editar autos em rascunho");

  const previous = await getPreviousCumulativeByItem(row.certificate.budgetDocumentId, row.certificate.number);
  const previousQty = previous.get(row.line.lineItemId) ?? 0;
  const result = validateMeasuredQuantity({
    previousQty,
    periodQty: input.periodQty,
    budgetedQty: row.budgetedQty === null ? null : Number(row.budgetedQty),
    overrunReason: input.overrunReason,
  });
  const [updated] = await db
    .update(measurementCertificateLines)
    .set({
      periodQty: input.periodQty.toString(),
      cumulativeQty: result.cumulativeQty.toString(),
      notes: input.notes?.trim() || null,
      overrunReason: input.overrunReason?.trim() || null,
    })
    .where(eq(measurementCertificateLines.id, certificateLineId))
    .returning();
  return updated;
}

export async function getCertificateDetail(certificateId: string) {
  const [certificate] = await db.select().from(measurementCertificates).where(eq(measurementCertificates.id, certificateId)).limit(1);
  if (!certificate) return null;
  const lines = await db
    .select({
      id: measurementCertificateLines.id,
      lineItemId: measurementCertificateLines.lineItemId,
      cumulativeQty: measurementCertificateLines.cumulativeQty,
      periodQty: measurementCertificateLines.periodQty,
      notes: measurementCertificateLines.notes,
      overrunReason: measurementCertificateLines.overrunReason,
      sectionId: budgetSections.id,
      sectionName: budgetSections.name,
      sectionSortOrder: budgetSections.sortOrder,
      code: lineItems.code,
      description: lineItems.description,
      unit: lineItems.unit,
      budgetedQty: lineItems.quantity,
      unitPrice: lineItems.unitPrice,
      itemSortOrder: lineItems.sortOrder,
    })
    .from(measurementCertificateLines)
    .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(eq(measurementCertificateLines.certificateId, certificateId))
    .orderBy(budgetSections.sortOrder, lineItems.sortOrder);

  const lineIds = lines.map((line) => line.id);
  const fieldMemoryRows = lineIds.length
    ? await db
        .select({ certificateLineId: measurementCertificateFieldLines.certificateLineId })
        .from(measurementCertificateFieldLines)
        .where(and(
          inArray(measurementCertificateFieldLines.certificateLineId, lineIds),
          eq(measurementCertificateFieldLines.isActive, true),
        ))
    : [];
  const linesWithFieldMemory = new Set(fieldMemoryRows.map((row) => row.certificateLineId));

  return {
    certificate,
    lines: lines.map((line) => {
      const unitPrice = Number(line.unitPrice ?? 0);
      const budgetedQty = line.budgetedQty === null ? null : Number(line.budgetedQty);
      const cumulativeQty = Number(line.cumulativeQty);
      const periodQty = Number(line.periodQty);
      return {
        ...line,
        description: technicalDescription(line.description),
        unitPrice,
        budgetedQty,
        cumulativeQty,
        previousQty: cumulativeQty - periodQty,
        periodQty,
        periodValue: periodQty * unitPrice,
        cumulativeValue: cumulativeQty * unitPrice,
        remainingQty: budgetedQty === null ? null : budgetedQty - cumulativeQty,
        percentExecuted: budgetedQty ? (cumulativeQty / budgetedQty) * 100 : null,
        hasOverrun: budgetedQty !== null && cumulativeQty > budgetedQty + 0.0001,
        hasFieldMemory: linesWithFieldMemory.has(line.id),
      };
    }),
  };
}

export async function getMeasurementDashboard(budgetDocumentId: string) {
  const [latest] = await db
    .select()
    .from(measurementCertificates)
    .where(and(eq(measurementCertificates.budgetDocumentId, budgetDocumentId), eq(measurementCertificates.status, "aprovado")))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);
  if (!latest) return { hasCertificates: false as const };
  const detail = await getCertificateDetail(latest.id);
  const [document] = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, budgetDocumentId)).limit(1);
  const unitPriceFactor = calculateBudgetTotals(1, {
    siteCostsRate: Number(document?.siteCostsRate ?? 0),
    indirectCostsRate: Number(document?.indirectCostsRate ?? 0),
    profitMarginRate: Number(document?.profitMarginRate ?? 0),
  }).unitPriceFactor;
  const clientLines = detail!.lines.map((line) => ({
    ...line,
    unitPrice: line.unitPrice * unitPriceFactor,
    periodValue: line.periodValue * unitPriceFactor,
    cumulativeValue: line.cumulativeValue * unitPriceFactor,
  }));
  const previstoTotal = clientLines.reduce((sum, line) => sum + (line.budgetedQty ?? 0) * line.unitPrice, 0);
  const executadoTotal = clientLines.reduce((sum, line) => sum + line.cumulativeValue, 0);
  return {
    hasCertificates: true as const,
    latestCertificateNumber: latest.number,
    previstoTotal,
    executadoTotal,
    percentExecutado: previstoTotal ? (executadoTotal / previstoTotal) * 100 : 0,
    linhas: clientLines,
  };
}
