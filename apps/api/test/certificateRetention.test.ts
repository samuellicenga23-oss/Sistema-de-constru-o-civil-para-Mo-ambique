import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";
import { db } from "../src/db/index.js";
import { projectContracts, projects } from "../src/db/schema.js";

describe("contract retention & variations (prompt 10)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let projectId: string;
  let contractId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const company = await createCompany("Retenção Lda");
    const user = await createUser(company.id, "admin_empresa", "retencao@test.local");
    cookie = await loginCookie(app, user.email);
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra Ret", client: "Cliente", currency: "MZN" }).returning();
    projectId = project.id;
    const [contract] = await db.insert(projectContracts).values({
      projectId,
      contractNumber: "CT-001",
      clientName: "Cliente",
      originalAmount: "1000000",
      retentionRate: "0.05",
      status: "activo",
      createdByUserId: user.id,
    }).returning();
    contractId = contract.id;
  });

  it("cria variação com scope e evidence stub", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/contracts/${contractId}/variations`,
      headers: { cookie },
      payload: {
        title: "Adenda eléctrica",
        scope: "Alteração de traçado de cabos",
        reason: "Pedido do cliente",
        amount: 250000,
        linkedTaskIds: [],
        evidenceUrls: ["/uploads/evidence-1.pdf"],
      },
    });
    if (res.statusCode !== 201) console.error(res.body);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.scope).toContain("cabos");
    expect(body.evidenceUrls).toHaveLength(1);
  });
});
