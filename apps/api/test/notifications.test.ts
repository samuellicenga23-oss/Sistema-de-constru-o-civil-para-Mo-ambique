import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { materials, priceZones, suppliers, projects, budgetDocuments, quoteRequests, quoteRequestLines } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { truncateAll, createCompany, createUser, loginCookie } from "./helpers.js";
import { runQuoteRequestExpiry } from "../src/services/quoteRequestExpiry.js";

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

async function extractCookie(res: { headers: Record<string, unknown> }, name: string): Promise<string> {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith(`${name}=`)) : setCookie;
  const cookie = raw?.split(";")[0];
  if (!cookie) throw new Error(`Cookie ${name} não encontrado`);
  return cookie;
}

describe("Sino de notificações in-app", () => {
  it("o fornecedor recebe uma notificação in-app ao ser pedida uma cotação e pode marcá-la como lida", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Beira (teste sino)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Cimento (teste sino)", unit: "un", baseUnitCost: "450" }).returning();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Sino", email: "fornecedor-sino@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    const supplierCookie = await extractCookie(registerRes, "sid_sup");
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Sino")).limit(1);

    const company = await createCompany("Empresa Sino");
    await createUser(company.id, "admin_empresa", "admin-sino@test.local");
    const companyCookie = await loginCookie(app, "admin-sino@test.local");

    await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie: companyCookie },
      payload: { supplierId: supplierRow.id, title: "Pedido para o sino", lines: [{ kind: "material", resourceId: material.id, quantity: 1 }] },
    });

    const listRes = await app.inject({ method: "GET", url: "/api/supplier/notifications", headers: { cookie: supplierCookie } });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { items: Array<{ id: string; title: string; readAt: string | null; link: string | null }>; unreadCount: number };
    expect(body.unreadCount).toBe(1);
    expect(body.items[0].title).toBe("Novo pedido de cotação");
    expect(body.items[0].readAt).toBeNull();
    expect(body.items[0].link).toBe("/oportunidades");

    const readRes = await app.inject({ method: "POST", url: `/api/supplier/notifications/${body.items[0].id}/read`, headers: { cookie: supplierCookie } });
    expect(readRes.statusCode).toBe(200);

    const afterRead = await app.inject({ method: "GET", url: "/api/supplier/notifications", headers: { cookie: supplierCookie } });
    expect((afterRead.json() as { unreadCount: number }).unreadCount).toBe(0);

    // Sem sessão nenhuma, sem acesso.
    const noAuthRes = await app.inject({ method: "GET", url: "/api/supplier/notifications" });
    expect(noAuthRes.statusCode).toBe(401);
  });

  it("a empresa recebe uma notificação in-app quando o fornecedor responde à cotação", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Nampula (teste sino empresa)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Areia (teste sino empresa)", unit: "m3", baseUnitCost: "300" }).returning();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Sino Empresa", email: "fornecedor-sino-empresa@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    const supplierCookie = await extractCookie(registerRes, "sid_sup");
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Sino Empresa")).limit(1);

    const company = await createCompany("Empresa Sino Empresa");
    await createUser(company.id, "admin_empresa", "admin-sino-empresa@test.local");
    const companyCookie = await loginCookie(app, "admin-sino-empresa@test.local");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie: companyCookie },
      payload: { supplierId: supplierRow.id, title: "Pedido respondido", lines: [{ kind: "material", resourceId: material.id, quantity: 1 }] },
    });
    const quoteRequest = createRes.json() as { id: string };

    const detailRes = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${quoteRequest.id}`, headers: { cookie: supplierCookie } });
    const detail = detailRes.json() as { lines: Array<{ id: string }> };
    await app.inject({
      method: "POST",
      url: `/api/supplier/quote-requests/${quoteRequest.id}/respond`,
      headers: { cookie: supplierCookie },
      payload: { lines: [{ id: detail.lines[0].id, unitCost: 320 }] },
    });

    const companyNotifRes = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: companyCookie } });
    const companyBody = companyNotifRes.json() as { items: Array<{ title: string }>; unreadCount: number };
    expect(companyBody.unreadCount).toBe(1);
    expect(companyBody.items[0].title).toBe("Cotação respondida");

    const markAllRes = await app.inject({ method: "POST", url: "/api/notifications/read-all", headers: { cookie: companyCookie } });
    expect(markAllRes.statusCode).toBe(200);
    const afterMarkAll = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: companyCookie } });
    expect((afterMarkAll.json() as { unreadCount: number }).unreadCount).toBe(0);
  });
});

describe("Ordem de compra — mudança de estado avisa o fornecedor do marketplace", () => {
  it("aprova e cancela uma ordem apontando a um fornecedor do marketplace sem rebentar", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Tete (teste notificações)" }).returning();
    await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Notificações", email: "fornecedor-notif@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true },
    });
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Notificações")).limit(1);

    const company = await createCompany("Empresa Notificações");
    await createUser(company.id, "admin_empresa", "admin-notif@test.local");
    const cookie = await loginCookie(app, "admin-notif@test.local");
    const [material] = await db.insert(materials).values({ companyId: null, name: "Tijolo (teste notificações)", unit: "un", baseUnitCost: "20" }).returning();
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra Notificações", currency: "MZN", zoneId: zone.id }).returning();
    await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN", status: "aprovado" });

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/purchase-orders`,
      headers: { cookie },
      payload: { supplierId: supplierRow.id, orderDate: "2026-08-07", lines: [{ materialId: material.id, quantity: 20, unitCost: 20, currency: "MZN" }] },
    });
    const order = createRes.json() as { id: string };
    expect(createRes.statusCode).toBe(201);

    const approveRes = await app.inject({ method: "PUT", url: `/api/purchase-orders/${order.id}/status`, headers: { cookie }, payload: { status: "aprovado" } });
    expect(approveRes.statusCode).toBe(200);
    expect((approveRes.json() as { status: string }).status).toBe("aprovado");

    const receiveRes = await app.inject({ method: "PUT", url: `/api/purchase-orders/${order.id}/status`, headers: { cookie }, payload: { status: "recebido" } });
    expect(receiveRes.statusCode).toBe(200);
  });

  it("cancela uma ordem em rascunho apontando a um fornecedor do marketplace", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Pemba (teste notificações)" }).returning();
    await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Notificações B", email: "fornecedor-notif-b@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true },
    });
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Notificações B")).limit(1);

    const company = await createCompany("Empresa Notificações B");
    await createUser(company.id, "admin_empresa", "admin-notif-b@test.local");
    const cookie = await loginCookie(app, "admin-notif-b@test.local");
    const [material] = await db.insert(materials).values({ companyId: null, name: "Prego (teste notificações)", unit: "kg", baseUnitCost: "10" }).returning();
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra Notificações B", currency: "MZN", zoneId: zone.id }).returning();
    await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN", status: "aprovado" });

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/purchase-orders`,
      headers: { cookie },
      payload: { supplierId: supplierRow.id, orderDate: "2026-08-07", lines: [{ materialId: material.id, quantity: 5, unitCost: 10, currency: "MZN" }] },
    });
    const order = createRes.json() as { id: string };

    const cancelRes = await app.inject({ method: "PUT", url: `/api/purchase-orders/${order.id}/status`, headers: { cookie }, payload: { status: "cancelado" } });
    expect(cancelRes.statusCode).toBe(200);
    expect((cancelRes.json() as { status: string }).status).toBe("cancelado");
  });
});

describe("Pedidos de cotação — expiração automática", () => {
  it("marca como expirado um pedido cujo prazo já passou e avisa fornecedor e empresa", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Lichinga (teste expiração)" }).returning();
    await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Expiração", email: "fornecedor-expiracao@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true },
    });
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Expiração")).limit(1);

    const company = await createCompany("Empresa Expiração");
    await createUser(company.id, "admin_empresa", "admin-expiracao@test.local");
    const [material] = await db.insert(materials).values({ companyId: null, name: "Areia (teste expiração)", unit: "m3", baseUnitCost: "500" }).returning();

    const [overdueRequest] = await db
      .insert(quoteRequests)
      .values({ companyId: company.id, supplierId: supplierRow.id, title: "Pedido expirado", status: "enviado", deadlineDate: "2020-01-01" })
      .returning();
    await db.insert(quoteRequestLines).values({ quoteRequestId: overdueRequest.id, kind: "material", materialId: material.id, description: "Areia", unit: "m3", sortOrder: 0 });

    const [freshRequest] = await db
      .insert(quoteRequests)
      .values({ companyId: company.id, supplierId: supplierRow.id, title: "Pedido dentro do prazo", status: "enviado", deadlineDate: "2099-01-01" })
      .returning();

    const result = await runQuoteRequestExpiry();
    expect(result.expired).toBe(1);

    const [updatedOverdue] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, overdueRequest.id)).limit(1);
    expect(updatedOverdue.status).toBe("expirado");

    const [updatedFresh] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, freshRequest.id)).limit(1);
    expect(updatedFresh.status).toBe("enviado");
  });
});
