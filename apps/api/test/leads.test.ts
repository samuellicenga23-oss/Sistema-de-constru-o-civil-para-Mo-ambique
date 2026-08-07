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

  it("aceita um pedido público com comprovativo anexado (multipart)", async () => {
    const boundary = "----sigoTestBoundary";
    const fields: Record<string, string> = {
      name: "Cliente Com Comprovativo",
      company: "Obra Com Comprovativo Lda",
      email: "com-comprovativo@test.local",
      phone: "+258840000001",
      planOrPack: "Individual",
      billingCycle: "mensal",
    };
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    }
    const fakePdf = Buffer.from("%PDF-1.4\n%teste");
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="comprovativo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const body = Buffer.concat([
      Buffer.from(parts.join("")),
      Buffer.from(fileHeader),
      fakePdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/public/leads",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);

    await createUser(null, "super_admin", "super-leads3@test.local");
    const superCookie = await loginCookie(app, "super-leads3@test.local");
    const listResponse = await app.inject({ method: "GET", url: "/api/admin/leads", headers: { cookie: superCookie } });
    const leads = listResponse.json() as Array<{ id: string; proofFilePath: string | null; proofOriginalFileName: string | null }>;
    expect(leads).toHaveLength(1);
    expect(leads[0].proofFilePath).toBeTruthy();
    expect(leads[0].proofOriginalFileName).toBe("comprovativo.pdf");

    const proofResponse = await app.inject({ method: "GET", url: `/api/admin/leads/${leads[0].id}/proof`, headers: { cookie: superCookie } });
    expect(proofResponse.statusCode).toBe(200);
    expect(proofResponse.headers["content-type"]).toBe("application/pdf");
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
