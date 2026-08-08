import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, sql } from "./index.js";
import { budgetDocuments, budgetSections, costCompositions, lineItems, projects } from "./schema.js";
import { STANDARD_CHAPTERS } from "../services/boqTemplate.js";
import { computeCompositionUnitCostV2 } from "../services/costEngineV2.js";

async function main() {
  const documentId = process.argv[2];
  if (!documentId) throw new Error("Indique o ID do documento.");

  const [document] = await db
    .select({
      title: budgetDocuments.title,
      status: budgetDocuments.status,
      documentType: budgetDocuments.documentType,
      companyId: projects.companyId,
      zoneId: projects.zoneId,
    })
    .from(budgetDocuments)
    .innerJoin(projects, eq(projects.id, budgetDocuments.projectId))
    .where(eq(budgetDocuments.id, documentId))
    .limit(1);
  if (!document) throw new Error("Documento não encontrado.");
  if (document.status !== "rascunho") throw new Error(`O documento «${document.title}» está ${document.status}; crie uma revisão antes de recalcular.`);

  const templates = STANDARD_CHAPTERS.flatMap((chapter) => chapter.items);
  const templateByCode = new Map(templates.map((item) => [item.code, item]));
  const compositionNames = templates.flatMap((item) => item.composition ? [item.composition] : []);
  const compositions = await db
    .select({ id: costCompositions.id, name: costCompositions.name, companyId: costCompositions.companyId })
    .from(costCompositions)
    .where(and(inArray(costCompositions.name, compositionNames), or(isNull(costCompositions.companyId), eq(costCompositions.companyId, document.companyId))));
  const compositionByName = new Map<string, string>();
  for (const composition of compositions.filter((item) => item.companyId === null)) compositionByName.set(composition.name, composition.id);
  for (const composition of compositions.filter((item) => item.companyId !== null)) compositionByName.set(composition.name, composition.id);

  const sections = await db.select({ id: budgetSections.id }).from(budgetSections).where(eq(budgetSections.documentId, documentId));
  if (!sections.length) throw new Error("O documento não contém secções.");
  const items = await db
    .select()
    .from(lineItems)
    .where(and(inArray(lineItems.sectionId, sections.map((section) => section.id)), eq(lineItems.kind, "item")));

  let descriptions = 0;
  let prices = 0;
  let linked = 0;
  for (const item of items) {
    if (!item.code) continue;
    const template = templateByCode.get(item.code);
    if (!template) continue;
    const compositionId = template.composition ? compositionByName.get(template.composition) ?? item.compositionId : item.compositionId;
    const unitPrice = compositionId && document.documentType === "orcamento"
      ? (await computeCompositionUnitCostV2(compositionId, document.companyId, document.zoneId)).unitCost
      : null;

    await db.update(lineItems).set({
      description: template.description,
      ...(compositionId ? { compositionId, origin: "composicao" as const } : {}),
      ...(unitPrice !== null ? { unitPrice: unitPrice.toString() } : {}),
    }).where(eq(lineItems.id, item.id));
    if (item.description !== template.description) descriptions++;
    if (compositionId && item.compositionId !== compositionId) linked++;
    if (unitPrice !== null && Number(item.unitPrice) !== unitPrice) prices++;
  }

  console.log(`Documento: ${document.title}`);
  console.log(`Descrições simplificadas: ${descriptions}`);
  console.log(`Composições associadas: ${linked}`);
  console.log(`Preços unitários recalculados: ${prices}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
