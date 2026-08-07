import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { auditEvents, budgetDocuments, budgetSections, lineItems, materials, projects, costCompositions, compositionMaterialLines, financialEntries, priceZones, materialZonePrices } from "../src/db/schema.js";
import { truncateAll, createCompany, createUser, loginCookie } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

beforeEach(async () => {
  await truncateAll();
});

describe("Isolamento multi-tenant e catálogo global", () => {
  it("Empresa A não consegue ver o projecto da Empresa B", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [projectB] = await db.insert(projects).values({ companyId: companyB.id, name: "Projecto B", currency: "MZN" }).returning();

    const cookieA = await loginCookie(app, "a@test.local");
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectB.id}`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(404);
  });

  it("Empresa A consegue consultar o catálogo global de materiais", async () => {
    const companyA = await createCompany("Empresa A");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await db.insert(materials).values({ companyId: null, name: "Cimento (teste)", unit: "un", baseUnitCost: "500" });

    const cookieA = await loginCookie(app, "a@test.local");
    const res = await app.inject({ method: "GET", url: "/api/catalog/materials", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ name: string }>;
    expect(list.some((m) => m.name === "Cimento (teste)")).toBe(true);
  });

  it("editar o preço de um material clona-o para a Empresa A e não altera o que a Empresa B vê", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [globalMaterial] = await db.insert(materials).values({ companyId: null, name: "Aço A400 (teste)", unit: "kg", baseUnitCost: "92" }).returning();

    const cookieA = await loginCookie(app, "a@test.local");
    const editRes = await app.inject({
      method: "PUT",
      url: `/api/catalog/materials/${globalMaterial.id}`,
      headers: { cookie: cookieA },
      payload: { baseUnitCost: 120 },
    });
    expect(editRes.statusCode).toBe(200);

    const cookieB = await loginCookie(app, "b@test.local");
    const listB = await app.inject({ method: "GET", url: "/api/catalog/materials", headers: { cookie: cookieB } });
    const materialForB = (listB.json() as Array<{ name: string; baseUnitCost: string }>).find((m) => m.name === "Aço A400 (teste)");
    expect(materialForB?.baseUnitCost).toBe("92.0000");

    const listA = await app.inject({ method: "GET", url: "/api/catalog/materials", headers: { cookie: cookieA } });
    const materialForA = (listA.json() as Array<{ name: string; baseUnitCost: string }>).find((m) => m.name === "Aço A400 (teste)");
    expect(materialForA?.baseUnitCost).toBe("120.0000");
  });

  it("Empresa A não consegue clonar material ou zona privados da Empresa B por UUID", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [materialB] = await db.insert(materials).values({ companyId: companyB.id, name: "Material confidencial B", unit: "un", baseUnitCost: "9876" }).returning();
    const [zoneB] = await db.insert(priceZones).values({ companyId: companyB.id, name: "Zona confidencial B" }).returning();
    const cookieA = await loginCookie(app, "a@test.local");

    const materialCloneAttempt = await app.inject({
      method: "PUT",
      url: `/api/catalog/materials/${materialB.id}`,
      headers: { cookie: cookieA },
      payload: { baseUnitCost: 1 },
    });
    expect(materialCloneAttempt.statusCode).toBe(404);

    // Zonas deixaram de ser edítáveis por empresas (lista nacional única, só o super_admin gere
    // — ver routes/priceZones.ts) — bloqueado pelo papel antes sequer de chegar à lógica de posse.
    const zoneCloneAttempt = await app.inject({
      method: "PUT",
      url: `/api/catalog/price-zones/${zoneB.id}`,
      headers: { cookie: cookieA },
      payload: { name: "Tentativa de cópia" },
    });
    expect(zoneCloneAttempt.statusCode).toBe(403);

    const visibleMaterials = await app.inject({ method: "GET", url: "/api/catalog/materials", headers: { cookie: cookieA } });
    expect((visibleMaterials.json() as Array<{ name: string }>).some((row) => row.name === "Material confidencial B")).toBe(false);
  });

  it("Empresa A não recebe preços associados a uma zona privada da Empresa B", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    const [globalMaterial] = await db.insert(materials).values({ companyId: null, name: "Material global", unit: "un", baseUnitCost: "100" }).returning();
    const [zoneB] = await db.insert(priceZones).values({ companyId: companyB.id, name: "Zona privada B" }).returning();
    await db.insert(materialZonePrices).values({ materialId: globalMaterial.id, zoneId: zoneB.id, unitCost: "999" });
    const cookieA = await loginCookie(app, "a@test.local");

    const catalog = await app.inject({ method: "GET", url: `/api/catalog/materials?zoneId=${zoneB.id}`, headers: { cookie: cookieA } });
    expect(catalog.statusCode).toBe(200);
    const material = (catalog.json() as Array<{ id: string; effectiveUnitCost: number }>).find((row) => row.id === globalMaterial.id);
    expect(material?.effectiveUnitCost).toBe(100);

    const prices = await app.inject({ method: "GET", url: `/api/catalog/materials/${globalMaterial.id}/zone-prices`, headers: { cookie: cookieA } });
    expect(prices.statusCode).toBe(200);
    expect((prices.json() as Array<{ zoneId: string }>).some((row) => row.zoneId === zoneB.id)).toBe(false);
  });

  it("composição global reflecte o preço clonado pela empresa no custo total (regressão do bug encontrado na Etapa 3)", async () => {
    const companyA = await createCompany("Empresa A");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    const [cement] = await db.insert(materials).values({ companyId: null, name: "Cimento composição (teste)", unit: "un", baseUnitCost: "650" }).returning();
    const [composition] = await db
      .insert(costCompositions)
      .values({ companyId: null, name: "Betão (teste)", category: "estrutura", outputUnit: "m3", currency: "MZN" })
      .returning();
    await db.insert(compositionMaterialLines).values({ compositionId: composition.id, materialId: cement.id, qtyPerUnit: "7" });

    const cookieA = await loginCookie(app, "a@test.local");

    // Antes de qualquer edição: usa o preço global.
    const before = await app.inject({ method: "GET", url: `/api/catalog/compositions/${composition.id}`, headers: { cookie: cookieA } });
    expect((before.json() as { materialCost: number }).materialCost).toBe(4550); // 7 * 650

    // A empresa clona só o MATERIAL (nunca a composição inteira) ao mudar o preço.
    await app.inject({ method: "PUT", url: `/api/catalog/materials/${cement.id}`, headers: { cookie: cookieA }, payload: { baseUnitCost: 450 } });

    const after = await app.inject({ method: "GET", url: `/api/catalog/compositions/${composition.id}`, headers: { cookie: cookieA } });
    expect((after.json() as { materialCost: number }).materialCost).toBe(3150); // 7 * 450 — reflecte o clone
  });

  it("Financeiro de um projecto não é visível para outra empresa", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [projectA] = await db.insert(projects).values({ companyId: companyA.id, name: "Projecto A", currency: "MZN" }).returning();
    await db.insert(financialEntries).values({ projectId: projectA.id, type: "despesa", category: "Materiais", amount: "1000", currency: "MZN" });

    const cookieB = await loginCookie(app, "b@test.local");
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectA.id}/financial-entries`, headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });

  it("regista uma alteraÃ§Ã£o financeira no histÃ³rico da obra sem expÃ´-la a outra empresa", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [projectA] = await db.insert(projects).values({ companyId: companyA.id, name: "Projecto A", currency: "MZN" }).returning();
    const cookieA = await loginCookie(app, "a@test.local");

    const create = await app.inject({
      method: "POST",
      url: `/api/projects/${projectA.id}/financial-entries`,
      headers: { cookie: cookieA },
      payload: { type: "despesa", category: "Materiais", amount: 1250, currency: "MZN" },
    });
    expect(create.statusCode).toBe(201);

    const events = await app.inject({ method: "GET", url: `/api/projects/${projectA.id}/audit-events`, headers: { cookie: cookieA } });
    expect(events.statusCode).toBe(200);
    expect((events.json() as Array<{ action: string; entityType: string }>)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "created", entityType: "financial_entry" }),
    ]));
    const control = await app.inject({ method: "GET", url: `/api/projects/${projectA.id}/control`, headers: { cookie: cookieA } });
    expect(control.statusCode).toBe(200);
    expect(control.json()).toMatchObject({ currency: "MZN", commercial: { receivableValue: 0 }, cost: { paidValue: 0, committedValue: 1250 } });
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectA.id));
    expect(rows).toHaveLength(1);

    const cookieB = await loginCookie(app, "b@test.local");
    const foreign = await app.inject({ method: "GET", url: `/api/projects/${projectA.id}/audit-events`, headers: { cookie: cookieB } });
    expect(foreign.statusCode).toBe(404);
  });

  it("separa submissão e aprovação de um orçamento", async () => {
    const company = await createCompany("Empresa A");
    await createUser(company.id, "admin_empresa", "admin@test.local");
    await createUser(company.id, "orcamentista", "orc@test.local");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Projecto A", currency: "MZN" }).returning();
    const [document] = await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN", documentType: "orcamento" }).returning();
    const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Trabalhos", sortOrder: 1 }).returning();
    await db.insert(lineItems).values({ sectionId: section.id, kind: "item", description: "Betão", unit: "m3", quantity: "2", unitPrice: "5000", sortOrder: 1 });
    const cookieOrc = await loginCookie(app, "orc@test.local");
    const submit = await app.inject({ method: "PATCH", url: `/api/budget-documents/${document.id}/status`, headers: { cookie: cookieOrc }, payload: { status: "submetido" } });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().submittedByUserId).toBeTruthy();

    const selfApproval = await app.inject({ method: "PATCH", url: `/api/budget-documents/${document.id}/status`, headers: { cookie: cookieOrc }, payload: { status: "aprovado" } });
    expect(selfApproval.statusCode).toBe(403);

    const cookieAdmin = await loginCookie(app, "admin@test.local");
    const approval = await app.inject({ method: "PATCH", url: `/api/budget-documents/${document.id}/status`, headers: { cookie: cookieAdmin }, payload: { status: "aprovado" } });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toMatchObject({ status: "aprovado", approvedByUserId: expect.any(String) });
  });
});
