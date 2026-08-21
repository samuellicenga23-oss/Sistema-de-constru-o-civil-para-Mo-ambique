import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { companies, materials } from "../src/db/schema.js";
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

describe("price observations API (prompt 05)", () => {
  it("rejeita criação sem campos obrigatórios", async () => {
    const company = await createCompany("Empresa Preços");
    await createUser(company.id, "orcamentista", "precos@test.local");
    const cookie = await loginCookie(app, "precos@test.local");

    const res = await app.inject({
      method: "POST",
      url: "/api/price-observations",
      headers: { cookie },
      payload: { resourceType: "material", unitCost: 100, unit: "kg" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita refId inválido", async () => {
    const company = await createCompany("Empresa Ref");
    await createUser(company.id, "orcamentista", "ref@test.local");
    const cookie = await loginCookie(app, "ref@test.local");
    const familyKey = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/api/price-observations",
      headers: { cookie },
      payload: {
        resourceFamilyKey: familyKey,
        resourceType: "material",
        refId: randomUUID(),
        unitCost: 120,
        unit: "kg",
        observedAt: "2026-08-01",
        source: "Mercado local",
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/Material/);
  });

  it("cria observação e resolve mediana por política da empresa", async () => {
    const company = await createCompany("Empresa Mediana");
    await createUser(company.id, "orcamentista", "mediana@test.local");
    const cookie = await loginCookie(app, "mediana@test.local");

    const [material] = await db
      .insert(materials)
      .values({
        companyId: company.id,
        name: "Cimento teste",
        unit: "kg",
        baseUnitCost: "100",
        importFactor: "1",
        defaultWastePct: "0",
      })
      .returning();

    await db
      .update(companies)
      .set({ effectivePricePolicy: "median_n", effectivePriceMedianN: 3 })
      .where(eq(companies.id, company.id));

    const basePayload = {
      resourceFamilyKey: material.familyKey,
      resourceType: "material" as const,
      refId: material.id,
      unit: "kg" as const,
      observedAt: "2026-08-01",
      source: "Fornecedor teste",
    };

    for (const [unitCost, confidence, date] of [
      [100, "confirmed", "2026-06-01"],
      [200, "confirmed", "2026-07-01"],
      [300, "confirmed", "2026-08-01"],
      [999, "estimated", "2026-08-10"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/price-observations",
        headers: { cookie },
        payload: { ...basePayload, unitCost, confidence, observedAt: date },
      });
      expect(res.statusCode).toBe(201);
    }

    const listRes = await app.inject({
      method: "GET",
      url: `/api/price-observations?resourceFamilyKey=${material.familyKey}&resourceType=material`,
      headers: { cookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { observations: unknown[] }).observations).toHaveLength(4);

    const effectiveRes = await app.inject({
      method: "GET",
      url: `/api/price-observations/effective?resourceFamilyKey=${material.familyKey}&resourceType=material`,
      headers: { cookie },
    });
    expect(effectiveRes.statusCode).toBe(200);
    const body = effectiveRes.json() as { policy: string; effective: { unitCost: number; observationCount: number } | null };
    expect(body.policy).toBe("median_n");
    expect(body.effective?.unitCost).toBe(200);
    expect(body.effective?.observationCount).toBe(3);
  });
});
