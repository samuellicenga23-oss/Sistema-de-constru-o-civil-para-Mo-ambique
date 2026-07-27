import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db/index.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";

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

async function projectContext(currency: "MZN" | "USD" = "MZN") {
  const company = await createCompany("Empresa Medições");
  await createUser(company.id, "orcamentista", "medicoes@test.local");
  const cookie = await loginCookie(app, "medicoes@test.local");
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "Obra de Teste", currency },
  });
  expect(projectResponse.statusCode).toBe(201);
  return { cookie, project: projectResponse.json() as { id: string; defaultDocumentId: string } };
}

describe("Percurso planta → diagnóstico → mapa automático", () => {
  it("mantém mapas automáticos em MZN mesmo quando a moeda de gestão do projecto é USD", async () => {
    const { cookie, project } = await projectContext("USD");

    const documentsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-documents`,
      headers: { cookie },
    });
    expect(documentsResponse.statusCode).toBe(200);
    expect(documentsResponse.json()).toEqual([
      expect.objectContaining({ id: project.defaultDocumentId, currency: "MZN" }),
    ]);

    const workspaceResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/measurement-workspace`,
      headers: { cookie },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json()).toEqual({
      document: expect.objectContaining({ id: project.defaultDocumentId, currency: "MZN" }),
      created: false,
    });
  });

  it("recusa rotular custos automáticos MZN como USD, mas permite documento manual USD", async () => {
    const { cookie, project } = await projectContext();

    const automaticResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/budget-documents`,
      headers: { cookie },
      payload: { title: "Automático USD", currency: "USD", template: "padrao" },
    });
    expect(automaticResponse.statusCode).toBe(400);
    expect(automaticResponse.json().error).toContain("mapas automáticos");

    const manualResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/budget-documents`,
      headers: { cookie },
      payload: { title: "Importado USD", currency: "USD", template: "vazio" },
    });
    expect(manualResponse.statusCode).toBe(201);
    expect(manualResponse.json()).toEqual(expect.objectContaining({ currency: "USD" }));
  });

  it("não aplica medições automáticas a um documento manual incompatível", async () => {
    const { cookie, project } = await projectContext();
    const manualResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/budget-documents`,
      headers: { cookie },
      payload: { title: "Mapa recebido", currency: "MZN", template: "vazio" },
    });
    const manual = manualResponse.json() as { id: string };

    const estimateResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${manual.id}/quick-estimate`,
      headers: { cookie },
      payload: {
        floors: [{ ceilingHeight: 2.8, perimeter: 40, rooms: [{ name: "Sala", type: "seco", length: 5, width: 4 }] }],
        foundationType: "sapata_isolada",
        footing: { count: 4, avgArea: 0.6, avgDepth: 0.8 },
        concreteClass: "B25",
        roofType: "laje_plana",
        roofArea: 22,
      },
    });
    expect(estimateResponse.statusCode).toBe(409);
    expect(estimateResponse.json().error).toContain("não usa a estrutura automática");
  });
});
