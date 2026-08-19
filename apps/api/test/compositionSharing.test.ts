import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { costCompositions, lineItemCostSnapshots, lineItems, budgetDocuments, budgetSections, projects, users } from "../src/db/schema.js";
import { truncateAll, createCompany, createUser, loginCookie } from "./helpers.js";
import { createLineItemCostSnapshot } from "../src/services/costSnapshotService.js";

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

describe("composições privadas e partilha", () => {
  it("isola composições privadas entre utilizadores da mesma empresa", async () => {
    const company = await createCompany("Empresa A");
    await createUser(company.id, "orcamentista", "ana@test.local");
    await createUser(company.id, "orcamentista", "bruno@test.local");
    const cookieAna = await loginCookie(app, "ana@test.local");
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/compositions",
      headers: { cookie: cookieAna },
      payload: { name: "Betão privado", category: "Estrutura", outputUnit: "m3", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({ visibility: "private" });

    const cookieBruno = await loginCookie(app, "bruno@test.local");
    const hidden = await app.inject({ method: "GET", url: `/api/catalog/compositions/${id}`, headers: { cookie: cookieBruno } });
    expect(hidden.statusCode).toBe(404);
    const mine = await app.inject({ method: "GET", url: "/api/catalog/compositions?scope=mine", headers: { cookie: cookieBruno } });
    expect((mine.json() as Array<{ id: string }>).some((row) => row.id === id)).toBe(false);
  });

  it("partilha view e edit e revoga", async () => {
    const company = await createCompany("Empresa A");
    await createUser(company.id, "orcamentista", "ana@test.local");
    await createUser(company.id, "orcamentista", "bruno@test.local");
    const cookieAna = await loginCookie(app, "ana@test.local");
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/compositions",
      headers: { cookie: cookieAna },
      payload: { name: "Reboco", category: "Acabamentos", outputUnit: "m2", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    const id = created.json().id as string;

    const shareView = await app.inject({
      method: "POST",
      url: `/api/catalog/compositions/${id}/shares`,
      headers: { cookie: cookieAna },
      payload: { email: "bruno@test.local", permission: "view" },
    });
    expect(shareView.statusCode).toBe(201);

    const cookieBruno = await loginCookie(app, "bruno@test.local");
    const seen = await app.inject({ method: "GET", url: `/api/catalog/compositions/${id}`, headers: { cookie: cookieBruno } });
    expect(seen.statusCode).toBe(200);
    const editDenied = await app.inject({
      method: "PUT",
      url: `/api/catalog/compositions/${id}`,
      headers: { cookie: cookieBruno },
      payload: { name: "Reboco interior", category: "Acabamentos", outputUnit: "m2", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    expect(editDenied.statusCode).toBe(403);

    const shareEdit = await app.inject({
      method: "POST",
      url: `/api/catalog/compositions/${id}/shares`,
      headers: { cookie: cookieAna },
      payload: { email: "bruno@test.local", permission: "edit" },
    });
    expect(shareEdit.statusCode).toBe(201);
    const editOk = await app.inject({
      method: "PUT",
      url: `/api/catalog/compositions/${id}`,
      headers: { cookie: cookieBruno },
      payload: { name: "Reboco interior", category: "Acabamentos", outputUnit: "m2", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    expect(editOk.statusCode).toBe(200);

    const [bruno] = await db.select().from(users).where(eq(users.email, "bruno@test.local"));
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/catalog/compositions/${id}/shares/${bruno.id}`,
      headers: { cookie: cookieAna },
    });
    expect(revoke.statusCode).toBe(200);
    const hiddenAgain = await app.inject({ method: "GET", url: `/api/catalog/compositions/${id}`, headers: { cookie: cookieBruno } });
    expect(hiddenAgain.statusCode).toBe(404);
  });

  it("duplica para a biblioteca privada sem alterar a origem", async () => {
    const company = await createCompany("Empresa A");
    await createUser(company.id, "admin_empresa", "admin@test.local");
    const [global] = await db.insert(costCompositions).values({
      companyId: null,
      name: "Betão SIGO",
      category: "Estrutura",
      outputUnit: "m3",
      visibility: "global",
    }).returning();
    const cookie = await loginCookie(app, "admin@test.local");
    const forked = await app.inject({ method: "POST", url: `/api/catalog/compositions/${global.id}/fork`, headers: { cookie } });
    expect(forked.statusCode).toBe(201);
    expect(forked.json()).toMatchObject({ visibility: "private", parentCompositionId: global.id, name: "Betão SIGO" });
    expect(forked.json().id).not.toBe(global.id);
    const [origin] = await db.select().from(costCompositions).where(eq(costCompositions.id, global.id));
    expect(origin.visibility).toBe("global");
    expect(origin.companyId).toBeNull();
  });

  it("mantém snapshot histórico depois de editar a composição", async () => {
    const company = await createCompany("Empresa A");
    const user = await createUser(company.id, "admin_empresa", "admin@test.local");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra", currency: "MZN" }).returning();
    const [document] = await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN" }).returning();
    const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Estrutura", sortOrder: 0 }).returning();
    const cookie = await loginCookie(app, "admin@test.local");
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/compositions",
      headers: { cookie },
      payload: { name: "Laje", category: "Estrutura", outputUnit: "m2", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    const compositionId = created.json().id as string;
    const [item] = await db.insert(lineItems).values({
      sectionId: section.id,
      kind: "item",
      description: "Laje",
      unit: "m2",
      quantity: "10",
      unitPrice: "100",
      compositionId,
      origin: "composicao",
    }).returning();
    await createLineItemCostSnapshot({
      lineItemId: item.id,
      compositionId,
      companyId: company.id,
      currency: "MZN",
      reason: "attached",
    });
    const before = await db.select().from(lineItemCostSnapshots).where(eq(lineItemCostSnapshots.lineItemId, item.id));
    expect(before.length).toBeGreaterThan(0);
    const captured = before[0].unitCost;
    await app.inject({
      method: "PUT",
      url: `/api/catalog/compositions/${compositionId}`,
      headers: { cookie },
      payload: { name: "Laje", category: "Estrutura", outputUnit: "m2", currency: "MZN", labourLines: [], materialLines: [], equipmentLines: [] },
    });
    const after = await db.select().from(lineItemCostSnapshots).where(eq(lineItemCostSnapshots.lineItemId, item.id));
    expect(after[0].unitCost).toBe(captured);
    expect(user.id).toBeTruthy();
  });
});
