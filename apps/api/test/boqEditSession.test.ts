import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { budgetDocuments, budgetSections, lineItems, projects } from "../src/db/schema.js";
import { truncateAll, createCompany, createUser, loginCookie } from "./helpers.js";
import { applyBoqEditSession, BoqEditValidationError } from "../src/services/boqEditSession.js";

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

async function seedDocument(companyName = "Empresa A", email = "a@test.local") {
  const company = await createCompany(companyName);
  const user = await createUser(company.id, "admin_empresa", email);
  const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra", currency: "MZN" }).returning();
  const [document] = await db.insert(budgetDocuments).values({ projectId: project.id, title: "Mapa", currency: "MZN", documentType: "orcamento" }).returning();
  const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Alvenaria", sortOrder: 0 }).returning();
  const [item] = await db.insert(lineItems).values({
    sectionId: section.id,
    kind: "item",
    description: "Parede",
    unit: "m2",
    quantity: "10",
    unitPrice: "100",
    sortOrder: 0,
  }).returning();
  return { company, user, project, document, section, item, cookie: await loginCookie(app, email) };
}

describe("sessão de edição BOQ", () => {
  it("aplica várias operações numa transacção", async () => {
    const { document, item, cookie } = await seedDocument();
    const get = await app.inject({ method: "GET", url: `/api/budget-documents/${document.id}`, headers: { cookie } });
    expect(get.statusCode).toBe(200);
    const fingerprint = (get.json() as { editFingerprint: string }).editFingerprint;
    const createdId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${document.id}/edit-session`,
      headers: { cookie },
      payload: {
        baseFingerprint: fingerprint,
        operations: [
          { op: "update_item", id: item.id, fields: { quantity: 4 } },
          { op: "add_item", id: createdId, sectionId: item.sectionId, parentId: null, fields: { kind: "item", description: "Laje", unit: "m2", quantity: 2, unitPrice: 50 } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sections: Array<{ items: Array<{ id: string; quantity: number; description: string }> }>; editFingerprint: string };
    expect(body.sections[0].items.find((row) => row.id === item.id)?.quantity).toBe(4);
    expect(body.sections[0].items.some((row) => row.id === createdId && row.description === "Laje")).toBe(true);
    expect(body.editFingerprint).not.toBe(fingerprint);
  });

  it("rejeita conflito 409 quando o fingerprint mudou", async () => {
    const { document, item, cookie } = await seedDocument();
    const get = await app.inject({ method: "GET", url: `/api/budget-documents/${document.id}`, headers: { cookie } });
    const fingerprint = (get.json() as { editFingerprint: string }).editFingerprint;
    await db.update(lineItems).set({ quantity: "12" }).where(eq(lineItems.id, item.id));
    const res = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${document.id}/edit-session`,
      headers: { cookie },
      payload: {
        baseFingerprint: fingerprint,
        operations: [{ op: "update_item", id: item.id, fields: { quantity: 3 } }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "Documento alterado. Recarregar", code: "DOCUMENT_CHANGED" });
    const [unchanged] = await db.select().from(lineItems).where(eq(lineItems.id, item.id));
    expect(Number(unchanged.quantity)).toBe(12);
  });

  it("reverte a transacção se uma operação falhar", async () => {
    const { document, item, user } = await seedDocument();
    const get = await app.inject({
      method: "GET",
      url: `/api/budget-documents/${document.id}`,
      headers: { cookie: await loginCookie(app, "a@test.local") },
    });
    const fingerprint = (get.json() as { editFingerprint: string }).editFingerprint;
    await expect(applyBoqEditSession({
      documentId: document.id,
      companyId: user.companyId!,
      actorUserId: user.id,
      projectId: document.projectId,
      currency: "MZN",
      baseFingerprint: fingerprint,
      operations: [
        { op: "update_item", id: item.id, fields: { quantity: 1 } },
        { op: "update_item", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fields: { quantity: 9 } },
      ],
    })).rejects.toBeInstanceOf(BoqEditValidationError);
    const [row] = await db.select().from(lineItems).where(eq(lineItems.id, item.id));
    expect(Number(row.quantity)).toBe(10);
  });

  it("isola a sessão entre empresas", async () => {
    const a = await seedDocument("Empresa A", "a@test.local");
    const companyB = await createCompany("Empresa B");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const cookieB = await loginCookie(app, "b@test.local");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${a.document.id}/edit-session`,
      headers: { cookie: cookieB },
      payload: {
        baseFingerprint: "0".repeat(64),
        operations: [{ op: "update_item", id: a.item.id, fields: { quantity: 1 } }],
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("bloqueia documentos submetidos", async () => {
    const { document, item, cookie } = await seedDocument();
    await db.update(budgetDocuments).set({ status: "submetido" }).where(eq(budgetDocuments.id, document.id));
    const res = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${document.id}/edit-session`,
      headers: { cookie },
      payload: {
        baseFingerprint: "0".repeat(64),
        operations: [{ op: "update_item", id: item.id, fields: { quantity: 1 } }],
      },
    });
    expect(res.statusCode).toBe(409);
  });
});
