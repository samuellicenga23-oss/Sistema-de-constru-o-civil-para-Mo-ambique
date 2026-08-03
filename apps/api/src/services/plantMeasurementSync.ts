import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems, measurementLines } from "../db/schema.js";
import { buildMeasurementLinesFromPlant, loadProjectPlantContext, supportedPlantItemCodes } from "./plantMeasurementLink.js";

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
  if (!context.rooms.length && !context.openings.length) return { updatedItems: 0 };

  const items = await db.select({
    id: lineItems.id,
    code: lineItems.code,
    quantity: lineItems.quantity,
    origin: lineItems.origin,
  }).from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(
      inArray(budgetSections.documentId, documents.map((document) => document.id)),
      eq(lineItems.kind, "item"),
      inArray(lineItems.code, supportedPlantItemCodes()),
    ));

  let updatedItems = 0;
  for (const item of items) {
    if (!item.code) continue;
    const existing = await db.select({ id: measurementLines.id }).from(measurementLines).where(eq(measurementLines.lineItemId, item.id));
    const alreadyFromPlant = item.origin === "planta";
    if (!alreadyFromPlant && (existing.length > 0 || Number(item.quantity ?? 0) !== 0)) continue;

    const built = buildMeasurementLinesFromPlant(item.code, context.rooms, context.openings);
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
