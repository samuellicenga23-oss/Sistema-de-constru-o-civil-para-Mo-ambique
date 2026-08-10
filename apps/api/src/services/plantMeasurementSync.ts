import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems, measurementLines } from "../db/schema.js";
import { buildMeasurementLinesFromPlant, loadProjectPlantContext } from "./plantMeasurementLink.js";

/**
 * Mantém rascunhos de medição ligados aos dados confirmados da planta.
 * Nunca substitui uma quantidade/medição manual: só preenche linhas vazias ou
 * actualiza linhas cuja origem já era a própria planta.
 */
export async function syncProjectPlantMeasurements(projectId: string): Promise<{ updatedItems: number }> {
  const documents = await db.select({ id: budgetDocuments.id }).from(budgetDocuments).where(and(
    eq(budgetDocuments.projectId, projectId),
    eq(budgetDocuments.documentType, "medicao"),
    eq(budgetDocuments.status, "rascunho"),
  ));
  if (!documents.length) return { updatedItems: 0 };

  const context = await loadProjectPlantContext(projectId);
  // Conflito de identidade: contextualizou-se a vazio de propósito. Limpar quantidades
  // com origem «planta» evita deixar saldos obsoletos a parecerem actuais enquanto
  // o utilizador não confirma a identidade da planta.
  if (!context.rooms.length && !context.openings.length && !context.hydroPipes.length && !context.hydroEquipment.length) {
    if (!context.identityConflict) return { updatedItems: 0 };
    return clearPlantOriginQuantities(documents.map((document) => document.id));
  }

  const items = await db.select({
    id: lineItems.id,
    code: lineItems.code,
    description: lineItems.description,
    quantity: lineItems.quantity,
    origin: lineItems.origin,
  }).from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(
      inArray(budgetSections.documentId, documents.map((document) => document.id)),
      eq(lineItems.kind, "item"),
    ));

  const existingLineCounts = items.length
    ? await db
        .select({ lineItemId: measurementLines.lineItemId })
        .from(measurementLines)
        .where(inArray(measurementLines.lineItemId, items.map((item) => item.id)))
    : [];
  const itemsWithMeasurementLines = new Set(existingLineCounts.map((row) => row.lineItemId));

  let updatedItems = 0;
  for (const item of items) {
    if (!item.code) continue;
    const alreadyFromPlant = item.origin === "planta";
    if (!alreadyFromPlant && (itemsWithMeasurementLines.has(item.id) || Number(item.quantity ?? 0) !== 0)) continue;

    const built = buildMeasurementLinesFromPlant(
      item.code,
      context.rooms,
      context.openings,
      context.hydroPipes,
      item.description,
      context.hydroEquipment,
    );
    if (!built.ok) continue;
    const total = built.lines.reduce((sum, line) => sum
      + line.count * (line.length ?? 1) * (line.width ?? 1) * (line.height ?? 1), 0);

    await db.transaction(async (tx) => {
      await tx.delete(measurementLines).where(eq(measurementLines.lineItemId, item.id));
      if (built.lines.length) {
        await tx.insert(measurementLines).values(built.lines.map((line) => ({
          lineItemId: item.id,
          description: line.description,
          count: line.count.toFixed(2),
          length: line.length == null ? null : line.length.toFixed(3),
          width: line.width == null ? null : line.width.toFixed(3),
          height: line.height == null ? null : line.height.toFixed(3),
          sortOrder: line.sortOrder,
        })));
      }
      await tx.update(lineItems).set({ quantity: total.toFixed(2), origin: "planta" }).where(eq(lineItems.id, item.id));
    });
    updatedItems++;
  }
  return { updatedItems };
}

async function clearPlantOriginQuantities(documentIds: string[]): Promise<{ updatedItems: number }> {
  const plantItems = await db.select({
    id: lineItems.id,
  }).from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(
      inArray(budgetSections.documentId, documentIds),
      eq(lineItems.kind, "item"),
      eq(lineItems.origin, "planta"),
    ));
  if (!plantItems.length) return { updatedItems: 0 };

  await db.transaction(async (tx) => {
    await tx.delete(measurementLines).where(inArray(measurementLines.lineItemId, plantItems.map((item) => item.id)));
    await tx.update(lineItems)
      .set({ quantity: "0", origin: "planta" })
      .where(inArray(lineItems.id, plantItems.map((item) => item.id)));
  });
  return { updatedItems: plantItems.length };
}
