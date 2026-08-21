import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";
import { db } from "../src/db/index.js";
import { projects } from "../src/db/schema.js";

describe("field quality / HST (prompt 09)", () => {
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
    const company = await createCompany("Obra Qualidade Lda");
    const user = await createUser(company.id, "engenheiro_fiscal", "qualidade@test.local");
    cookie = await loginCookie(app, user.email);
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Edifício Teste", client: "Cliente", currency: "MZN" }).returning();
    projectId = project.id;
  });

  it("seeds checklist templates and creates inspection with pass/fail", async () => {
    const templates = await app.inject({ method: "GET", url: "/api/inspection-templates", headers: { cookie } });
    expect(templates.statusCode).toBe(200);
    const tplBody = templates.json() as { templates: Array<{ trade: string }> };
    expect(tplBody.templates.length).toBeGreaterThanOrEqual(7);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/quality-inspections`,
      headers: { cookie },
      payload: { trade: "betão", inspectionDate: "2026-08-21", status: "pass", location: "Piso 2" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("pass");
  });

  it("regista observação de risco HST e sync offline idempotente", async () => {
    const hst = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/hst-records`,
      headers: { cookie },
      payload: {
        recordType: "observacao_risco",
        recordDate: "2026-08-21",
        description: "Trabalho em altura sem linha de vida",
        offlineSyncKey: "offline-1",
      },
    });
    expect(hst.statusCode).toBe(201);

    const dup = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/hst-records`,
      headers: { cookie },
      payload: {
        recordType: "observacao_risco",
        recordDate: "2026-08-21",
        description: "Trabalho em altura sem linha de vida",
        offlineSyncKey: "offline-1",
      },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().id).toBe(hst.json().id);
  });
});
