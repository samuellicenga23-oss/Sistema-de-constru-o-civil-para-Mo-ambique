import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { budgetDocuments, budgetSections, lineItems, projects } from "../src/db/schema.js";
import { compareBudgetRevisions, decomposePriceQuantity } from "../src/services/budgetRevisionDiff.js";
import { createCompany, truncateAll } from "./helpers.js";

describe("decomposição quantidade vs preço", () => {
  it("isola o efeito quantidade do efeito preço", () => {
    const result = decomposePriceQuantity(10, 100, 12, 110);
    expect(result.previousTotal).toBe(1000);
    expect(result.total).toBe(1320);
    expect(result.delta).toBe(320);
    expect(result.quantityEffect).toBe(200);
    expect(result.priceEffect).toBe(120);
    expect(result.deltaPct).toBeCloseTo(32);
  });

  it("trata item novo como variação total no preço × quantidade actual", () => {
    const result = decomposePriceQuantity(null, null, 5, 40);
    expect(result.previousTotal).toBe(0);
    expect(result.total).toBe(200);
    expect(result.quantityEffect).toBe(0);
    expect(result.priceEffect).toBe(200);
  });
});

describe("comparação de revisões de orçamento", () => {
  beforeEach(truncateAll);

  it("devolve previous null quando não há revisão anterior", async () => {
    const company = await createCompany("Rev Diff");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra" }).returning();
    const [document] = await db.insert(budgetDocuments).values({
      projectId: project.id,
      title: "Orçamento",
      documentType: "orcamento",
      revision: "0",
      ivaRate: "0",
      contingenciasRate: "0",
    }).returning();
    const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Cap" }).returning();
    await db.insert(lineItems).values({
      sectionId: section.id,
      kind: "item",
      code: "1.1",
      description: "Betão",
      unit: "m3",
      quantity: "10",
      unitPrice: "1000",
    });
    const diff = await compareBudgetRevisions(document.id);
    expect(diff?.previous).toBeNull();
    expect(diff?.items).toEqual([]);
    expect(diff?.currentTotal).toBe(10000);
  });

  it("compara revisão actual com a anterior e decompõe quantidade vs preço", async () => {
    const company = await createCompany("Rev Diff 2");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra" }).returning();
    const [previous] = await db.insert(budgetDocuments).values({
      projectId: project.id,
      title: "Orçamento rev 0",
      documentType: "orcamento",
      revision: "0",
      ivaRate: "0",
      contingenciasRate: "0",
    }).returning();
    const [current] = await db.insert(budgetDocuments).values({
      projectId: project.id,
      title: "Orçamento rev 1",
      documentType: "orcamento",
      revision: "1",
      ivaRate: "0",
      contingenciasRate: "0",
    }).returning();
    const [prevSection] = await db.insert(budgetSections).values({ documentId: previous.id, name: "Cap" }).returning();
    const [currSection] = await db.insert(budgetSections).values({ documentId: current.id, name: "Cap" }).returning();
    await db.insert(lineItems).values([
      { sectionId: prevSection.id, kind: "item", code: "1.1", description: "Betão", unit: "m3", quantity: "10", unitPrice: "1000" },
      { sectionId: currSection.id, kind: "item", code: "1.1", description: "Betão", unit: "m3", quantity: "12", unitPrice: "1100" },
    ]);
    const diff = await compareBudgetRevisions(current.id);
    expect(diff?.previous?.id).toBe(previous.id);
    expect(diff?.items).toHaveLength(1);
    expect(diff?.items[0].quantityEffect).toBe(2000);
    expect(diff?.items[0].priceEffect).toBe(1200);
    expect(diff?.items[0].delta).toBe(3200);
    const stillPrevious = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, previous.id));
    expect(stillPrevious[0].status).toBe("rascunho");
  });
});
