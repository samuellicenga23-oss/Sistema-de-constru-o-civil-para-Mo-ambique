import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { budgetDocuments, budgetSections, extractedOpenings, lineItems, measurementLines, plants, projects } from "../src/db/schema.js";
import { syncProjectPlantMeasurements } from "../src/services/plantMeasurementSync.js";
import { createCompany, truncateAll } from "./helpers.js";

describe("sincronização automática das medições da planta", () => {
  beforeEach(truncateAll);

  it("preenche vãos confirmados e preserva quantidades manuais", async () => {
    const company = await createCompany("Obra Sync");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Moradia" }).returning();
    const [document] = await db.insert(budgetDocuments).values({ projectId: project.id, title: "Medição", documentType: "medicao" }).returning();
    const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Edifício", templateKey: "sigo_adaptativo_v1" }).returning();
    const [doorItem, windowItem, manualItem] = await db.insert(lineItems).values([
      { sectionId: section.id, kind: "item", code: "15.1", description: "Portas interiores", unit: "un", quantity: "0" },
      { sectionId: section.id, kind: "item", code: "15.3", description: "Janelas", unit: "m2", quantity: "0" },
      { sectionId: section.id, kind: "item", code: "5.1", description: "Pavimento manual", unit: "m2", quantity: "12" },
    ]).returning();
    const [plant] = await db.insert(plants).values({ projectId: project.id, discipline: "arquitectura", filePath: "teste.pdf", processingStatus: "concluido", processingProgress: 100 }).returning();
    await db.insert(extractedOpenings).values([
      { plantId: plant.id, kind: "porta", widthM: "0.900", heightM: "2.100", quantity: 3, floor: "Piso Térreo", location: "interior", confidence: "1", source: "manual", needsConfirmation: false, page: 1 },
      { plantId: plant.id, kind: "janela", widthM: "1.500", heightM: "1.200", quantity: 2, floor: "Piso Térreo", location: "exterior", confidence: "1", source: "manual", needsConfirmation: false, page: 1 },
    ]);

    const result = await syncProjectPlantMeasurements(project.id);
    expect(result.updatedItems).toBe(2);
    const [door, window, manual] = await Promise.all([
      db.select().from(lineItems).where(eq(lineItems.id, doorItem.id)).then((rows) => rows[0]),
      db.select().from(lineItems).where(eq(lineItems.id, windowItem.id)).then((rows) => rows[0]),
      db.select().from(lineItems).where(eq(lineItems.id, manualItem.id)).then((rows) => rows[0]),
    ]);
    expect(Number(door.quantity)).toBe(3);
    expect(Number(window.quantity)).toBeCloseTo(3.6);
    expect(Number(manual.quantity)).toBe(12);
    expect((await db.select().from(measurementLines).where(eq(measurementLines.lineItemId, doorItem.id)))).toHaveLength(1);
  });
});
