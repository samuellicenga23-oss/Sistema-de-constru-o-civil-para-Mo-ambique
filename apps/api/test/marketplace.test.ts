import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { materials, priceZones, suppliers, subscriptions, projects, budgetDocuments, companies } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
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

describe("SIGO Fornecedores — marketplace nacional", () => {
  it("um fornecedor registado publica os seus próprios preços, visíveis a empresas do plano Profissional", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Matola (teste marketplace)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Tijolo 20 furos (teste marketplace)", unit: "un", baseUnitCost: "35" }).returning();

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Materiais do Sul", email: "materiais-sul@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    expect(registerRes.statusCode).toBe(201);
    const supplierCookie = await extractCookie(registerRes, "sid_sup");

    const catalogRes = await app.inject({ method: "GET", url: "/api/supplier/marketplace/catalog", headers: { cookie: supplierCookie } });
    expect(catalogRes.statusCode).toBe(200);
    const catalog = catalogRes.json() as { materials: Array<{ id: string; name: string }> };
    expect(catalog.materials.some((m) => m.id === material.id)).toBe(true);

    const setPriceRes = await app.inject({
      method: "PUT",
      url: "/api/supplier/marketplace/materials",
      headers: { cookie: supplierCookie },
      payload: { materialId: material.id, unitCost: 42 },
    });
    expect(setPriceRes.statusCode).toBe(201);

    // Empresa Profissional (omissão em createCompany) vê o fornecedor e os seus preços.
    const company = await createCompany("Construtora Marketplace Lda");
    await createUser(company.id, "admin_empresa", "admin-marketplace@test.local");
    const companyCookie = await loginCookie(app, "admin-marketplace@test.local");

    const listRes = await app.inject({ method: "GET", url: `/api/marketplace/suppliers?zoneId=${zone.id}`, headers: { cookie: companyCookie } });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { locked: boolean; suppliers?: Array<{ name: string; materialCount: number }> };
    expect(listBody.locked).toBe(false);
    const found = listBody.suppliers?.find((s) => s.name === "Materiais do Sul");
    expect(found).toBeTruthy();
    expect(found!.materialCount).toBe(1);

    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Materiais do Sul")).limit(1);
    const pricesRes = await app.inject({ method: "GET", url: `/api/suppliers/${supplierRow.id}/materials`, headers: { cookie: companyCookie } });
    expect(pricesRes.statusCode).toBe(200);
    const prices = pricesRes.json() as Array<{ unitCost: string }>;
    expect(Number(prices[0].unitCost)).toBe(42);
  });

  it("bloqueia o marketplace e a leitura de preços de fornecedor para o plano Individual", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Beira (teste gate)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Material bloqueado", unit: "un", baseUnitCost: "10" }).returning();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Bloqueado", email: "fornecedor-bloqueado@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Bloqueado")).limit(1);
    void registerRes;

    const company = await createCompany("Empresa Plano Individual");
    await db.update(subscriptions).set({ plan: "individual" }).where(eq(subscriptions.companyId, company.id));
    await createUser(company.id, "admin_empresa", "admin-individual@test.local");
    const cookie = await loginCookie(app, "admin-individual@test.local");

    const listRes = await app.inject({ method: "GET", url: "/api/marketplace/suppliers", headers: { cookie } });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { locked: boolean; code?: string };
    expect(body.locked).toBe(true);
    expect(body.code).toBe("PLAN_MARKETPLACE_REQUIRED");

    const pricesRes = await app.inject({ method: "GET", url: `/api/suppliers/${supplierRow.id}/materials`, headers: { cookie } });
    expect(pricesRes.statusCode).toBe(402);

    const rfqRes = await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie },
      payload: { supplierId: supplierRow.id, title: "Pedido bloqueado", lines: [{ kind: "material", resourceId: material.id, quantity: 1 }] },
    });
    expect(rfqRes.statusCode).toBe(402);

    // SIGO Preços continua acessível em qualquer plano.
    const sigoListRes = await app.inject({ method: "GET", url: "/api/suppliers", headers: { cookie } });
    expect(sigoListRes.statusCode).toBe(200);
    const sigoSuppliers = sigoListRes.json() as Array<{ isReference: boolean }>;
    expect(sigoSuppliers.some((s) => s.isReference)).toBe(true);
  });
});

describe("Catálogo — «melhor cotação» inclui o marketplace nacional", () => {
  it("mostra a cotação do fornecedor do marketplace quando a zona corresponde e a empresa é Profissional", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Nampula (teste catálogo)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Cal hidráulica (teste catálogo)", unit: "kg", baseUnitCost: "50" }).returning();

    await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Nampula", email: "fornecedor-nampula@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    const supplierCookie = await (async () => {
      const res = await app.inject({ method: "POST", url: "/api/supplier/auth/login", payload: { email: "fornecedor-nampula@test.local", password: "senhaFornecedor1" } });
      const setCookie = res.headers["set-cookie"];
      const raw = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith("sid_sup=")) : setCookie;
      return raw!.split(";")[0];
    })();
    await app.inject({
      method: "PUT",
      url: "/api/supplier/marketplace/materials",
      headers: { cookie: supplierCookie },
      payload: { materialId: material.id, unitCost: 61.5 },
    });

    const company = await createCompany("Empresa Catálogo Marketplace");
    await createUser(company.id, "admin_empresa", "admin-catalogo-mkt@test.local");
    const companyCookie = await loginCookie(app, "admin-catalogo-mkt@test.local");

    const withZone = await app.inject({ method: "GET", url: `/api/catalog/materials?zoneId=${zone.id}`, headers: { cookie: companyCookie } });
    const materialWithZone = (withZone.json() as Array<{ id: string; marketPrice: string | null; marketSupplierName: string | null; marketPriceIsZoneSpecific: boolean }>).find((m) => m.id === material.id);
    expect(materialWithZone?.marketSupplierName).toBe("Fornecedor Nampula");
    expect(Number(materialWithZone?.marketPrice)).toBe(61.5);
    expect(materialWithZone?.marketPriceIsZoneSpecific).toBe(true);

    // Sem filtro de zona activo, a cotação do marketplace continua a aparecer (é um preço de
    // mercado real), mas já não marcada como específica da zona.
    const withoutZone = await app.inject({ method: "GET", url: "/api/catalog/materials", headers: { cookie: companyCookie } });
    const materialWithoutZone = (withoutZone.json() as Array<{ id: string; marketSupplierName: string | null; marketPriceIsZoneSpecific: boolean }>).find((m) => m.id === material.id);
    expect(materialWithoutZone?.marketSupplierName).toBe("Fornecedor Nampula");
    expect(materialWithoutZone?.marketPriceIsZoneSpecific).toBe(false);

    // Plano Individual não vê a cotação do marketplace, mesmo pedindo a zona certa.
    await db.update(subscriptions).set({ plan: "individual" }).where(eq(subscriptions.companyId, company.id));
    const lowPlanRes = await app.inject({ method: "GET", url: `/api/catalog/materials?zoneId=${zone.id}`, headers: { cookie: companyCookie } });
    const materialLowPlan = (lowPlanRes.json() as Array<{ id: string; marketSupplierName: string | null }>).find((m) => m.id === material.id);
    expect(materialLowPlan?.marketSupplierName).toBeNull();
  });
});

describe("Ordem de compra — fornecedor do marketplace com contacto", () => {
  it("cria uma ordem de compra apontando a um fornecedor do marketplace e devolve o contacto para ligar", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Chimoio (teste OC)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Brita 0/19 (teste OC)", unit: "m3", baseUnitCost: "900" }).returning();

    await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Pedreira Chimoio", email: "pedreira-chimoio@test.local", password: "senhaFornecedor1", phone: "+258841234567", zoneId: zone.id, offersMaterials: true },
    });
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Pedreira Chimoio")).limit(1);
    expect(supplierRow.contact).toBe("+258841234567");

    const company = await createCompany("Empresa OC Marketplace");
    await createUser(company.id, "admin_empresa", "admin-oc-marketplace@test.local");
    const cookie = await loginCookie(app, "admin-oc-marketplace@test.local");

    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra OC Marketplace", currency: "MZN", zoneId: zone.id }).returning();
    await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN", status: "aprovado" });

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/purchase-orders`,
      headers: { cookie },
      payload: {
        supplierId: supplierRow.id,
        orderDate: "2026-08-07",
        lines: [{ materialId: material.id, quantity: 10, unitCost: 900, currency: "MZN" }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { supplierName: string; supplierContact: string | null };
    expect(created.supplierName).toBe("Pedreira Chimoio");
    expect(created.supplierContact).toBe("+258841234567");

    const listRes = await app.inject({ method: "GET", url: `/api/projects/${project.id}/purchase-orders`, headers: { cookie } });
    const orders = listRes.json() as Array<{ supplierContact: string | null }>;
    expect(orders[0]?.supplierContact).toBe("+258841234567");

    // Plano Individual não pode criar ordem apontando a um fornecedor do marketplace.
    await db.update(subscriptions).set({ plan: "individual" }).where(eq(subscriptions.companyId, company.id));
    const blockedRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/purchase-orders`,
      headers: { cookie },
      payload: { supplierId: supplierRow.id, orderDate: "2026-08-07", lines: [{ materialId: material.id, quantity: 5, unitCost: 900, currency: "MZN" }] },
    });
    expect(blockedRes.statusCode).toBe(402);
  });
});

describe("Contacto de compras — o fornecedor vê quem pediu, para poder ligar", () => {
  it("mostra o nome/email de quem pediu a cotação e o telefone da empresa ao fornecedor", async () => {
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Quelimane (teste contacto)" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Cimento cola (teste contacto)", unit: "kg", baseUnitCost: "40" }).returning();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Contacto", email: "fornecedor-contacto@test.local", password: "senhaFornecedor1", zoneId: zone.id, offersMaterials: true, materialIds: [material.id] },
    });
    const supplierCookie = await extractCookie(registerRes, "sid_sup");
    const [supplierRow] = await db.select().from(suppliers).where(eq(suppliers.name, "Fornecedor Contacto")).limit(1);

    const company = await createCompany("Empresa Contacto Compras");
    await db.update(companies).set({ phone: "+258849998877" }).where(eq(companies.id, company.id));
    await createUser(company.id, "admin_empresa", "compras@test.local");
    const companyCookie = await loginCookie(app, "compras@test.local");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/quote-requests",
      headers: { cookie: companyCookie },
      payload: { supplierId: supplierRow.id, title: "Cotação com contacto", lines: [{ kind: "material", resourceId: material.id, quantity: 1 }] },
    });
    const quoteRequest = createRes.json() as { id: string };

    const listRes = await app.inject({ method: "GET", url: "/api/supplier/quote-requests", headers: { cookie: supplierCookie } });
    const listed = (listRes.json() as Array<{ id: string; buyerName: string | null; buyerEmail: string | null; companyPhone: string | null }>).find((r) => r.id === quoteRequest.id);
    expect(listed?.buyerName).toBe("Utilizador de Teste");
    expect(listed?.buyerEmail).toBe("compras@test.local");
    expect(listed?.companyPhone).toBe("+258849998877");

    const detailRes = await app.inject({ method: "GET", url: `/api/supplier/quote-requests/${quoteRequest.id}`, headers: { cookie: supplierCookie } });
    const detail = detailRes.json() as { buyerName: string | null; buyerEmail: string | null; companyPhone: string | null };
    expect(detail.buyerName).toBe("Utilizador de Teste");
    expect(detail.buyerEmail).toBe("compras@test.local");
    expect(detail.companyPhone).toBe("+258849998877");

    // A empresa ligada aparece no painel do fornecedor mesmo sendo um fornecedor do marketplace
    // (sem suppliers.companyId) — deriva-se de quote_requests, não da ficha do fornecedor.
    const companiesRes = await app.inject({ method: "GET", url: "/api/supplier/companies", headers: { cookie: supplierCookie } });
    const linkedCompanies = companiesRes.json() as Array<{ companyName: string }>;
    expect(linkedCompanies.some((c) => c.companyName === "Empresa Contacto Compras")).toBe(true);
  });
});
