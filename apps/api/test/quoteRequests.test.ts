import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { materials, suppliers, supplierAccounts, supplierMaterialPrices } from "../src/db/schema.js";
import { and, eq } from "drizzle-orm";
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

async function extractCookie(res: { headers: Record<string, unknown> }, name: string): Promise<string> {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith(`${name}=`)) : setCookie;
  const cookie = raw?.split(";")[0];
  if (!cookie) throw new Error(`Cookie ${name} não encontrado`);
  return cookie;
}

describe("Portal do Fornecedor — pedidos de cotação", () => {
  it("percorre o fluxo completo: convite, resposta do fornecedor e aceitação (só supplier_*_prices)", async () => {
    const company = await createCompany("Construtora RFQ Lda");
    await createUser(company.id, "admin_empresa", "admin-rfq@test.local");
    const companyCookie = await loginCookie(app, "admin-rfq@test.local");

    const [supplier] = await db.insert(suppliers).values({ companyId: company.id, name: "Cimentos do Sul" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Cimento 50kg (teste RFQ)", unit: "un", baseUnitCost: "450" }).returning();

    // 1. Convidar o fornecedor
    const inviteRes = await app.inject({
      method: "POST",
      url: `/api/suppliers/${supplier.id}/invite`,
      headers: { cookie: companyCookie },
      payload: { email: "fornecedor-rfq@test.local", name: "Cimentos do Sul" },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json()).toEqual(expect.objectContaining({ ok: true, alreadyActive: false }));

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, "fornecedor-rfq@test.local")).limit(1);
    expect(account?.inviteToken).toBeTruthy();

    // 2. Fornecedor aceita o convite
    const acceptRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/accept-invite",
      payload: { token: account!.inviteToken, password: "fornecedorSenha123" },
    });
    expect(acceptRes.statusCode).toBe(201);
    const supplierCookie = await extractCookie(acceptRes, "sid_sup");

    // 3. Empresa cria o pedido de cotação
    const createRes = await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie: companyCookie },
      payload: {
        supplierId: supplier.id,
        title: "Cotação de cimento para Obra Teste",
        lines: [{ kind: "material", resourceId: material.id, quantity: 200 }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const quoteRequest = createRes.json() as { id: string; status: string };
    expect(quoteRequest.status).toBe("enviado");

    // 4. Fornecedor vê o pedido no seu portal
    const supplierListRes = await app.inject({ method: "GET", url: "/api/supplier/quote-requests", headers: { cookie: supplierCookie } });
    expect(supplierListRes.statusCode).toBe(200);
    const supplierList = supplierListRes.json() as Array<{ id: string; companyName: string }>;
    expect(supplierList).toHaveLength(1);
    expect(supplierList[0].companyName).toBe("Construtora RFQ Lda");

    const supplierDetailRes = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${quoteRequest.id}`, headers: { cookie: supplierCookie } });
    const supplierDetail = supplierDetailRes.json() as { lines: Array<{ id: string }> };
    expect(supplierDetail.lines).toHaveLength(1);

    // 5. Fornecedor responde com o preço
    const respondRes = await app.inject({
      method: "POST",
      url: `/api/supplier/quote-requests/${quoteRequest.id}/respond`,
      headers: { cookie: supplierCookie },
      payload: { lines: [{ id: supplierDetail.lines[0].id, unitCost: 480 }], supplierNotes: "Entrega em 3 dias úteis" },
    });
    expect(respondRes.statusCode).toBe(200);
    expect(respondRes.json()).toEqual(expect.objectContaining({ status: "respondido" }));

    // 6. Empresa aceita a cotação — preço deve entrar no catálogo de fornecedores da empresa
    const acceptQuoteRes = await app.inject({
      method: "POST",
      url: `/api/quote-requests/${quoteRequest.id}/accept`,
      headers: { cookie: companyCookie },
    });
    expect(acceptQuoteRes.statusCode).toBe(200);
    expect(acceptQuoteRes.json()).toEqual(expect.objectContaining({ status: "aceite" }));

    const [priceRow] = await db.select().from(supplierMaterialPrices).where(eq(supplierMaterialPrices.supplierId, supplier.id)).limit(1);
    expect(priceRow).toBeTruthy();
    expect(Number(priceRow.unitCost)).toBe(480);
  });

  it("impede um fornecedor de ver o pedido de cotação de outro fornecedor", async () => {
    const companyA = await createCompany("Empresa A RFQ");
    const companyB = await createCompany("Empresa B RFQ");
    await createUser(companyA.id, "admin_empresa", "admin-a-rfq@test.local");
    await createUser(companyB.id, "admin_empresa", "admin-b-rfq@test.local");
    const cookieA = await loginCookie(app, "admin-a-rfq@test.local");
    const cookieB = await loginCookie(app, "admin-b-rfq@test.local");

    const [supplierA] = await db.insert(suppliers).values({ companyId: companyA.id, name: "Fornecedor A" }).returning();
    const [supplierB] = await db.insert(suppliers).values({ companyId: companyB.id, name: "Fornecedor B" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Areia (teste isolamento)", unit: "m3", baseUnitCost: "300" }).returning();

    await app.inject({ method: "POST", url: `/api/suppliers/${supplierA.id}/invite`, headers: { cookie: cookieA }, payload: { email: "fornecedor-a@test.local" } });
    await app.inject({ method: "POST", url: `/api/suppliers/${supplierB.id}/invite`, headers: { cookie: cookieB }, payload: { email: "fornecedor-b@test.local" } });

    const [accountA] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, "fornecedor-a@test.local")).limit(1);
    const [accountB] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, "fornecedor-b@test.local")).limit(1);

    await app.inject({ method: "POST", url: "/api/supplier/auth/accept-invite", payload: { token: accountA!.inviteToken, password: "senhaFornecedorA1" } });
    const acceptResB = await app.inject({ method: "POST", url: "/api/supplier/auth/accept-invite", payload: { token: accountB!.inviteToken, password: "senhaFornecedorB1" } });
    const supplierCookieB = await extractCookie(acceptResB, "sid_sup");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie: cookieA },
      payload: { supplierId: supplierA.id, title: "Pedido isolado", lines: [{ kind: "material", resourceId: material.id }] },
    });
    const quoteRequest = createRes.json() as { id: string };

    // Fornecedor B está autenticado mas não está ligado a este pedido — não deve conseguir vê-lo.
    const listAsB = await app.inject({ method: "GET", url: "/api/supplier/quote-requests", headers: { cookie: supplierCookieB } });
    expect(listAsB.json()).toEqual([]);

    const detailAsB = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${quoteRequest.id}`, headers: { cookie: supplierCookieB } });
    expect(detailAsB.statusCode).toBe(404);

    // Sem cookie nenhum — bloqueado antes de chegar à lógica de posse.
    const noAuthRes = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${quoteRequest.id}` });
    expect(noAuthRes.statusCode).toBe(401);
  });
});

describe("Fornecedor «SIGO Preços» — pedidos automáticos e preço único nacional", () => {
  it("gera um pedido de cotação automático para um material novo e aplica a resposta a todas as empresas", async () => {
    const companyA = await createCompany("Empresa A Preços SIGO");
    const companyB = await createCompany("Empresa B Preços SIGO");
    await createUser(companyA.id, "admin_empresa", "admin-a-sigo@test.local");
    const cookieA = await loginCookie(app, "admin-a-sigo@test.local");

    const [material] = await db.insert(materials).values({ companyId: null, name: "Cal aérea (teste SIGO)", unit: "kg", baseUnitCost: "20" }).returning();

    // GET /api/suppliers dispara syncSigoPricesForCompany — cria a ficha "SIGO Preços" desta
    // empresa, liga-a à conta global, e gera automaticamente um pedido de cotação para o material
    // novo (sem nenhum humano a pedir).
    const listA = await app.inject({ method: "GET", url: "/api/suppliers", headers: { cookie: cookieA } });
    const sigoSupplierA = (listA.json() as Array<{ id: string; name: string; supplierAccountId: string | null }>).find((s) => s.name === "SIGO Preços");
    expect(sigoSupplierA?.supplierAccountId).toBeTruthy();

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, "precos@sigomz.com")).limit(1);
    expect(account).toBeTruthy();
    expect(account!.inviteToken).toBeTruthy();

    const rfqsForA = await app.inject({ method: "GET", url: "/api/quote-requests", headers: { cookie: cookieA } });
    const autoRfq = (rfqsForA.json() as Array<{ id: string; supplierId: string; title: string }>).find((r) => r.supplierId === sigoSupplierA!.id);
    expect(autoRfq).toBeTruthy();
    expect(autoRfq!.title).toContain("material");

    // Outra empresa também gera a sua própria ficha "SIGO Preços" ligada à MESMA conta.
    await createUser(companyB.id, "admin_empresa", "admin-b-sigo@test.local");
    const cookieB = await loginCookie(app, "admin-b-sigo@test.local");
    const listB = await app.inject({ method: "GET", url: "/api/suppliers", headers: { cookie: cookieB } });
    const sigoSupplierB = (listB.json() as Array<{ id: string; name: string; supplierAccountId: string | null }>).find((s) => s.name === "SIGO Preços");
    expect(sigoSupplierB?.supplierAccountId).toBe(account!.id);

    // A equipa SIGO activa a conta global e entra no Portal do Fornecedor.
    const acceptRes = await app.inject({ method: "POST", url: "/api/supplier/auth/accept-invite", payload: { token: account!.inviteToken, password: "equipaSigoSenha1" } });
    const supplierCookie = await extractCookie(acceptRes, "sid_sup");

    const supplierDetailRes = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${autoRfq!.id}`, headers: { cookie: supplierCookie } });
    const supplierDetail = supplierDetailRes.json() as { lines: Array<{ id: string; description: string }> };
    expect(supplierDetail.lines.map((l) => l.description)).toContain("Cal aérea (teste SIGO)");

    await app.inject({
      method: "POST",
      url: `/api/supplier/quote-requests/${autoRfq!.id}/respond`,
      headers: { cookie: supplierCookie },
      payload: { lines: [{ id: supplierDetail.lines[0].id, unitCost: 22.5 }] },
    });

    const acceptQuoteRes = await app.inject({ method: "POST", url: `/api/quote-requests/${autoRfq!.id}/accept`, headers: { cookie: cookieA } });
    expect(acceptQuoteRes.statusCode).toBe(200);

    // O preço aceite na empresa A tem de aparecer também na empresa B, sem nenhum pedido próprio.
    const [priceB] = await db
      .select()
      .from(supplierMaterialPrices)
      .where(and(eq(supplierMaterialPrices.supplierId, sigoSupplierB!.id), eq(supplierMaterialPrices.materialId, material.id)));
    expect(Number(priceB.unitCost)).toBe(22.5);
  });
});
