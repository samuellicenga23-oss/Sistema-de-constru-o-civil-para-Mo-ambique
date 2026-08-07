import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { materials, suppliers, supplierMaterialPrices, priceZones, supplierAccounts } from "../src/db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ligação automática de preços (feed externo do fornecedor)", () => {
  it("guarda a ligação, sincroniza e actualiza os preços correspondentes", async () => {
    const company = await createCompany("Empresa Feed Automático");
    await createUser(company.id, "admin_empresa", "admin-feed@test.local");
    const cookie = await loginCookie(app, "admin-feed@test.local");

    const [supplier] = await db.insert(suppliers).values({ companyId: company.id, name: "Fornecedor Com Feed" }).returning();
    const [material] = await db.insert(materials).values({ companyId: null, name: "Brita 3/4 (teste feed)", unit: "m3", baseUnitCost: "1000", currency: "MZN" }).returning();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ items: [{ material: "Brita 3/4 (teste feed)", unitCost: 1250.5, currency: "MZN" }, { material: "Item Desconhecido XYZ", unitCost: 10 }] }),
      })),
    );

    const putRes = await app.inject({
      method: "PUT",
      url: `/api/suppliers/${supplier.id}/price-feed`,
      headers: { cookie },
      payload: { feedUrl: "https://fornecedor-exemplo.co.mz/precos", apiKey: "segredo123", intervalHours: 12, isActive: true },
    });
    expect(putRes.statusCode).toBe(200);
    const saved = putRes.json() as { feedUrl: string; hasApiKey: boolean };
    expect(saved.feedUrl).toBe("https://fornecedor-exemplo.co.mz/precos");
    expect(saved.hasApiKey).toBe(true);

    const syncRes = await app.inject({ method: "POST", url: `/api/suppliers/${supplier.id}/price-feed/sync`, headers: { cookie } });
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.json()).toEqual(expect.objectContaining({ ok: true, matched: 1, unmatched: 1 }));

    const [price] = await db
      .select()
      .from(supplierMaterialPrices)
      .where(and(eq(supplierMaterialPrices.supplierId, supplier.id), eq(supplierMaterialPrices.materialId, material.id), isNull(supplierMaterialPrices.zoneId)));
    expect(Number(price.unitCost)).toBe(1250.5);

    const getRes = await app.inject({ method: "GET", url: `/api/suppliers/${supplier.id}/price-feed`, headers: { cookie } });
    const feed = getRes.json() as { lastSyncStatus: string; lastSyncMatched: number; lastSyncUnmatched: number };
    expect(feed.lastSyncStatus).toBe("sucesso");
    expect(feed.lastSyncMatched).toBe(1);
    expect(feed.lastSyncUnmatched).toBe(1);
  });

  it("regista erro sem rebentar quando o feed falha ou responde mal formado", async () => {
    const company = await createCompany("Empresa Feed Com Erro");
    await createUser(company.id, "admin_empresa", "admin-feed-erro@test.local");
    const cookie = await loginCookie(app, "admin-feed-erro@test.local");
    const [supplier] = await db.insert(suppliers).values({ companyId: company.id, name: "Fornecedor Feed Instável" }).returning();

    await app.inject({
      method: "PUT",
      url: `/api/suppliers/${supplier.id}/price-feed`,
      headers: { cookie },
      payload: { feedUrl: "https://fornecedor-instavel.co.mz/precos", intervalHours: 24, isActive: true },
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const syncRes = await app.inject({ method: "POST", url: `/api/suppliers/${supplier.id}/price-feed/sync`, headers: { cookie } });
    expect(syncRes.statusCode).toBe(422);

    const getRes = await app.inject({ method: "GET", url: `/api/suppliers/${supplier.id}/price-feed`, headers: { cookie } });
    const feed = getRes.json() as { lastSyncStatus: string; lastSyncError: string };
    expect(feed.lastSyncStatus).toBe("erro");
    expect(feed.lastSyncError).toContain("503");
  });

  it("recusa URLs privados/locais (protecção contra SSRF)", async () => {
    const company = await createCompany("Empresa Feed SSRF");
    await createUser(company.id, "admin_empresa", "admin-feed-ssrf@test.local");
    const cookie = await loginCookie(app, "admin-feed-ssrf@test.local");
    const [supplier] = await db.insert(suppliers).values({ companyId: company.id, name: "Fornecedor Feed SSRF" }).returning();

    await app.inject({
      method: "PUT",
      url: `/api/suppliers/${supplier.id}/price-feed`,
      headers: { cookie },
      payload: { feedUrl: "http://127.0.0.1:4100/api/health", intervalHours: 24, isActive: true },
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const syncRes = await app.inject({ method: "POST", url: `/api/suppliers/${supplier.id}/price-feed/sync`, headers: { cookie } });
    expect(syncRes.statusCode).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Centro de Controlo — visão do Portal do Fornecedor", () => {
  it("lista fornecedores registados no marketplace (sem convite — activados desde logo)", async () => {
    await createUser(null, "super_admin", "super-af@test.local");
    const superCookie = await loginCookie(app, "super-af@test.local");
    const [zone] = await db.insert(priceZones).values({ companyId: null, name: "Xai-Xai (teste admin)" }).returning();

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/supplier/auth/register",
      payload: { name: "Fornecedor Visível No Admin", email: "fornecedor-admin-visivel@test.local", password: "senhaFornecedor1", zoneId: zone.id },
    });
    expect(registerRes.statusCode).toBe(201);

    const listRes = await app.inject({ method: "GET", url: "/api/admin/supplier-accounts", headers: { cookie: superCookie } });
    expect(listRes.statusCode).toBe(200);
    const accounts = listRes.json() as Array<{ id: string; email: string; activated: boolean }>;
    const account = accounts.find((a) => a.email === "fornecedor-admin-visivel@test.local");
    expect(account).toBeTruthy();
    // Registo público já vem com password definida — activo desde logo, sem convite.
    expect(account!.activated).toBe(true);

    const forbiddenRes = await app.inject({ method: "GET", url: "/api/admin/supplier-accounts" });
    expect(forbiddenRes.statusCode).toBe(401);
  });

  it("permite reenviar o convite pendente da conta global «SIGO Preços»", async () => {
    const company = await createCompany("Empresa Reenvio SIGO");
    await createUser(company.id, "admin_empresa", "admin-reenvio@test.local");
    const companyCookie = await loginCookie(app, "admin-reenvio@test.local");
    await createUser(null, "super_admin", "super-reenvio@test.local");
    const superCookie = await loginCookie(app, "super-reenvio@test.local");

    // GET /api/suppliers cria a conta global "SIGO Preços" (ainda por activar) na primeira vez.
    await app.inject({ method: "GET", url: "/api/suppliers", headers: { cookie: companyCookie } });

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, "precos@sigomz.com")).limit(1);
    expect(account?.passwordHash).toBeNull();

    const resendRes = await app.inject({ method: "POST", url: `/api/admin/supplier-accounts/${account!.id}/resend-invite`, headers: { cookie: superCookie } });
    expect(resendRes.statusCode).toBe(200);
  });
});
