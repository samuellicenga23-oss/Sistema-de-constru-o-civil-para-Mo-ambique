import { eq, and, inArray, lt, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  measurementCertificates,
  measurementCertificateLines,
  budgetSections,
  lineItems,
} from "../db/schema.js";

async function getLeafItemIds(budgetDocumentId: string): Promise<string[]> {
  const sections = await db.select({ id: budgetSections.id }).from(budgetSections).where(eq(budgetSections.documentId, budgetDocumentId));
  const sectionIds = sections.map((s) => s.id);
  if (!sectionIds.length) return [];
  const items = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(inArray(lineItems.sectionId, sectionIds), eq(lineItems.kind, "item")));
  return items.map((i) => i.id);
}

// Devolve, para cada lineItemId, o executado acumulado do certificado anterior (mais recente
// com número < beforeNumber) — usado como ponto de partida do novo auto e para calcular o
// "período" (delta) quando o utilizador actualiza o acumulado.
async function getPreviousCumulativeByItem(budgetDocumentId: string, beforeNumber: number): Promise<Map<string, number>> {
  const [previous] = await db
    .select()
    .from(measurementCertificates)
    .where(and(eq(measurementCertificates.budgetDocumentId, budgetDocumentId), lt(measurementCertificates.number, beforeNumber)))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);

  const map = new Map<string, number>();
  if (!previous) return map;

  const lines = await db.select().from(measurementCertificateLines).where(eq(measurementCertificateLines.certificateId, previous.id));
  for (const line of lines) map.set(line.lineItemId, Number(line.cumulativeQty));
  return map;
}

export async function createMeasurementCertificate(projectId: string, budgetDocumentId: string, periodDate: string) {
  const [{ number }] = await db
    .select({ number: measurementCertificates.number })
    .from(measurementCertificates)
    .where(eq(measurementCertificates.budgetDocumentId, budgetDocumentId))
    .orderBy(desc(measurementCertificates.number))
    .limit(1)
    .then((rows) => (rows.length ? rows : [{ number: 0 }]));

  const nextNumber = number + 1;
  const [certificate] = await db
    .insert(measurementCertificates)
    .values({ projectId, budgetDocumentId, number: nextNumber, periodDate })
    .returning();

  const itemIds = await getLeafItemIds(budgetDocumentId);
  const previousByItem = await getPreviousCumulativeByItem(budgetDocumentId, nextNumber);

  if (itemIds.length) {
    await db.insert(measurementCertificateLines).values(
      itemIds.map((lineItemId) => ({
        certificateId: certificate.id,
        lineItemId,
        cumulativeQty: (previousByItem.get(lineItemId) ?? 0).toString(),
        periodQty: "0",
      }))
    );
  }

  return certificate;
}

export async function updateCertificateLineCumulative(certificateLineId: string, newCumulativeQty: number) {
  const [line] = await db
    .select()
    .from(measurementCertificateLines)
    .where(eq(measurementCertificateLines.id, certificateLineId))
    .limit(1);
  if (!line) throw new Error("Linha de medição não encontrada");

  const [certificate] = await db
    .select()
    .from(measurementCertificates)
    .where(eq(measurementCertificates.id, line.certificateId))
    .limit(1);
  if (!certificate) throw new Error("Auto de medição não encontrado");
  if (certificate.status !== "rascunho") throw new Error("Só é possível editar autos em rascunho");

  const previousByItem = await getPreviousCumulativeByItem(certificate.budgetDocumentId, certificate.number);
  const previousCumulative = previousByItem.get(line.lineItemId) ?? 0;
  const periodQty = newCumulativeQty - previousCumulative;

  const [updated] = await db
    .update(measurementCertificateLines)
    .set({ cumulativeQty: newCumulativeQty.toString(), periodQty: periodQty.toString() })
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
      code: lineItems.code,
      description: lineItems.description,
      unit: lineItems.unit,
      budgetedQty: lineItems.quantity,
      unitPrice: lineItems.unitPrice,
    })
    .from(measurementCertificateLines)
    .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
    .where(eq(measurementCertificateLines.certificateId, certificateId));

  const enrichedLines = lines.map((l) => {
    const unitPrice = Number(l.unitPrice ?? 0);
    const budgetedQty = l.budgetedQty !== null ? Number(l.budgetedQty) : null;
    const cumulativeQty = Number(l.cumulativeQty);
    return {
      ...l,
      unitPrice,
      budgetedQty,
      cumulativeQty,
      periodQty: Number(l.periodQty),
      periodValue: Number(l.periodQty) * unitPrice,
      cumulativeValue: cumulativeQty * unitPrice,
      percentExecuted: budgetedQty ? (cumulativeQty / budgetedQty) * 100 : null,
    };
  });

  return { certificate, lines: enrichedLines };
}

export async function getMeasurementDashboard(budgetDocumentId: string) {
  const [latest] = await db
    .select()
    .from(measurementCertificates)
    .where(eq(measurementCertificates.budgetDocumentId, budgetDocumentId))
    .orderBy(desc(measurementCertificates.number))
    .limit(1);

  if (!latest) return { hasCertificates: false as const };

  const detail = await getCertificateDetail(latest.id);
  const previstoTotal = detail!.lines.reduce((sum, l) => sum + (l.budgetedQty ?? 0) * l.unitPrice, 0);
  const executadoTotal = detail!.lines.reduce((sum, l) => sum + l.cumulativeValue, 0);

  return {
    hasCertificates: true as const,
    latestCertificateNumber: latest.number,
    previstoTotal,
    executadoTotal,
    percentExecutado: previstoTotal ? (executadoTotal / previstoTotal) * 100 : 0,
    linhas: detail!.lines,
  };
}
