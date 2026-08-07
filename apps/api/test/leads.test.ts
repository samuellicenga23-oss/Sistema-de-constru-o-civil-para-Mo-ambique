import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db/index.js";
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

describe("Pedidos comerciais", () => {
  it("regista um pedido público (CheckoutPage) visível ao super_admin", async () => {
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/public/leads",
      payload: {
        name: "Dono da Obra",
        company: "Construtora Teste Lda",
        email: "dono@test.local",
        phone: "+258840000000",
        planOrPack: "Profissional",
        billingCycle: "mensal",
        notes: "Quero começar já",
      },
    });
    expect(registerRes.statusCode).toBe(201);

    await createUser(null, "super_admin", "super-leads@test.local");
    const superCookie = await loginCookie(app, "super-leads@test.local");

    const listResponse = await app.inject({ method: "GET", url: "/api/admin/leads", headers: { cookie: superCookie } });
    expect(listResponse.statusCode).toBe(200);
    const leads = listResponse.json() as Array<{ id: string; name: string; status: string; source: string }>;
    expect(leads).toHaveLength(1);
    expect(leads[0]).toEqual(expect.objectContaining({ name: "Dono da Obra", status: "novo", source: "checkout" }));

    const statusResponse = await app.inject({
      method: "PATCH",
      url: `/api/admin/leads/${leads[0].id}/status`,
      headers: { cookie: superCookie },
      payload: { status: "contactado" },
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual(expect.objectContaining({ status: "contactado" }));

    const filteredResponse = await app.inject({ method: "GET", url: "/api/admin/leads?status=novo", headers: { cookie: superCookie } });
    expect(filteredResponse.json()).toEqual([]);
  });

  it("bloqueia pedidos públicos malformados", async () => {
    const res = await app.inject({ method: "POST", url: "/api/public/leads", payload: { name: "Sem email" } });
    expect(res.statusCode).toBe(400);
  });

  it("regista um pedido de dentro da app já autenticada, sem repetir dados do utilizador", async () => {
    const company = await createCompany("Empresa Pedido Interno");
    await createUser(company.id, "admin_empresa", "admin-lead@test.local");
    const cookie = await loginCookie(app, "admin-lead@test.local");

    const res = await app.inject({
      method: "POST",
      url: "/api/companies/me/leads",
      headers: { cookie },
      payload: { source: "plan_upgrade", planOrPack: "Profissional" },
    });
    expect(res.statusCode).toBe(201);

    await createUser(null, "super_admin", "super-leads2@test.local");
    const superCookie = await loginCookie(app, "super-leads2@test.local");
    const listResponse = await app.inject({ method: "GET", url: "/api/admin/leads", headers: { cookie: superCookie } });
    const leads = listResponse.json() as Array<{ email: string; company: string | null; source: string }>;
    expect(leads).toHaveLength(1);
    expect(leads[0]).toEqual(expect.objectContaining({ email: "admin-lead@test.local", company: "Empresa Pedido Interno", source: "plan_upgrade" }));
  });
});
