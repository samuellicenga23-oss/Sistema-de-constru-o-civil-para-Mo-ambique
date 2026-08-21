import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";
import { db } from "../src/db/index.js";
import { projects, fiscalRateProfiles } from "../src/db/schema.js";
import { resolveIvaRateForCompany } from "../src/services/fiscalRateResolver.js";

describe("treasury & fiscal MZ (prompt 11)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let projectId: string;
  let companyId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const company = await createCompany("Tesouraria Lda");
    companyId = company.id;
    const user = await createUser(company.id, "admin_empresa", "tesouraria@test.local");
    cookie = await loginCookie(app, user.email);
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra TZ", client: "Cliente", currency: "MZN" }).returning();
    projectId = project.id;
    await db.insert(fiscalRateProfiles).values({ companyId: null, kind: "iva", rate: "0.160000", effectiveFrom: "2023-01-01", source: "test seed" });
  });

  it("resolve IVA via perfil fiscal nacional seed", async () => {
    const rate = await resolveIvaRateForCompany(companyId, "2026-08-21");
    expect(rate).toBe(0.16);
  });

  it("expõe forecast de tesouraria stub", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/treasury-forecast`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { lines: unknown[]; totals: { receitas: number; despesas: number } };
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.totals.receitas).toBeGreaterThanOrEqual(0);
  });
});
