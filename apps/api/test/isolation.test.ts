import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { materials, projects, costCompositions, compositionMaterialLines, financialEntries } from "../src/db/schema.js";
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
});
