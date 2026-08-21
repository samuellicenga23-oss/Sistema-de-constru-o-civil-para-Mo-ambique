import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";

describe("segurança da reatribuição de workflow", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let estimatorCookie: string;
  let targetUserId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const company = await createCompany("Workflow Seguro Lda");
    const admin = await createUser(company.id, "admin_empresa", "workflow-admin@test.local");
    const estimator = await createUser(company.id, "orcamentista", "workflow-estimator@test.local");
    const target = await createUser(company.id, "engenheiro_fiscal", "workflow-target@test.local");
    adminCookie = await loginCookie(app, admin.email);
    estimatorCookie = await loginCookie(app, estimator.email);
    targetUserId = target.id;
  });

  it("não permite que um utilizador comum force reatribuição com allowAssignee", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/workflow-tasks/00000000-0000-4000-8000-000000000001/reassign",
      headers: { cookie: estimatorCookie },
      payload: { toUserId: targetUserId, allowAssignee: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejeita a flag allowAssignee mesmo para admin; autorização não vem do browser", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/workflow-tasks/00000000-0000-4000-8000-000000000001/reassign",
      headers: { cookie: adminCookie },
      payload: { toUserId: targetUserId, allowAssignee: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it("aceita o formato mínimo autorizado e só depois consulta a tarefa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/workflow-tasks/00000000-0000-4000-8000-000000000001/reassign",
      headers: { cookie: adminCookie },
      payload: { toUserId: targetUserId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Tarefa não encontrada" });
  });
});
