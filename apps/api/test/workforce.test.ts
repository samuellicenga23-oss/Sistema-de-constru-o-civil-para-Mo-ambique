import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";
import { db } from "../src/db/index.js";
import { fiscalRateProfiles, projects } from "../src/db/schema.js";

describe("workforce & subcontractors (prompt 12)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const company = await createCompany("Equipas Lda");
    const user = await createUser(company.id, "engenheiro_fiscal", "equipas@test.local");
    cookie = await loginCookie(app, user.email);
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra EQ", client: "Cliente", currency: "MZN" }).returning();
    projectId = project.id;
    await db.insert(fiscalRateProfiles).values([
      { companyId: null, kind: "inss_employer", rate: "0.040000", effectiveFrom: "2023-01-01", source: "seed" },
      { companyId: null, kind: "inss_worker", rate: "0.030000", effectiveFrom: "2023-01-01", source: "seed" },
    ]);
  });

  it("expõe INSS configurável via perfil fiscal", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/workforce/inss-rates`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().inssEmployer.rate).toBe(0.04);
    expect(res.json().inssWorker.rate).toBe(0.03);
  });

  it("regista subempreiteiro com NUIT e timesheet stub", async () => {
    const sub = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/subcontractors`,
      headers: { cookie },
      payload: { name: "Electro MZ Lda", nuit: "123456789", contractValue: 500000 },
    });
    expect(sub.statusCode).toBe(201);
    expect(sub.json().nuit).toBe("123456789");

    const worker = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workforce/workers`,
      headers: { cookie },
      payload: { name: "João Pedreiro", trade: "Pedreiro" },
    });
    expect(worker.statusCode).toBe(201);

    const ts = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workforce/timesheets`,
      headers: { cookie },
      payload: { workerId: worker.json().id, workDate: "2026-08-21", hours: 8, overtimeHours: 1 },
    });
    expect(ts.statusCode).toBe(201);
    expect(Number(ts.json().overtimeHours)).toBe(1);
  });
});
