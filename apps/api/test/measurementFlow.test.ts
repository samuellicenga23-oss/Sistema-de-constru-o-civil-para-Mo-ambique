import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { plants } from "../src/db/schema.js";
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

async function projectContext(currency: "MZN" | "USD" = "MZN", projectType: "medicao" | "orcamento" = "orcamento") {
  const company = await createCompany("Empresa Medições");
  await createUser(company.id, "orcamentista", "medicoes@test.local");
  const cookie = await loginCookie(app, "medicoes@test.local");
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "Obra de Teste", currency, projectType },
  });
  expect(projectResponse.statusCode).toBe(201);
  return { cookie, project: projectResponse.json() as { id: string; defaultDocumentId: string } };
}

describe("Percurso planta → diagnóstico → mapa automático", () => {
  it("cria capítulos de medição conforme as disciplinas detectadas nas plantas", async () => {
    const { cookie, project } = await projectContext("MZN", "medicao");
    const customChapterResponse = await app.inject({
      method: "POST",
      url: "/api/catalog/work-chapters",
      headers: { cookie },
      payload: {
        code: "14",
        name: "SEGURANÇA ELECTRÓNICA",
        discipline: "electricidade",
        detectionTags: ["cctv", "alarme"],
        items: [{ code: "14.1", description: "Sistema CCTV completo", unit: "vg" }],
      },
    });
    expect(customChapterResponse.statusCode).toBe(201);
    await db.insert(plants).values({
      projectId: project.id,
      discipline: "arquitectura",
      filePath: "teste/adaptativo.pdf",
      processingStatus: "concluido",
      processingProgress: 100,
      documentAnalysis: {
        pageCount: 3,
        isMultiDiscipline: true,
        matchedTags: ["cctv"],
        sections: [
          { discipline: "arquitectura", label: "Arquitectura", startPage: 1, endPage: 1, pageCount: 1, confidence: 0.9, evidence: [] },
          { discipline: "hidrossanitario", label: "Hidrossanitário", startPage: 2, endPage: 2, pageCount: 1, confidence: 0.9, evidence: [] },
          { discipline: "electricidade", label: "Electricidade", startPage: 3, endPage: 3, pageCount: 1, confidence: 0.9, evidence: [] },
        ],
      },
    });

    const workspaceResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/measurement-workspace`,
      headers: { cookie },
    });
    expect(workspaceResponse.statusCode).toBe(200);

    const documentResponse = await app.inject({
      method: "GET",
      url: `/api/budget-documents/${project.defaultDocumentId}`,
      headers: { cookie },
    });
    const chapters = documentResponse.json().sections.flatMap(
      (section: { items: Array<{ kind: string; description: string }> }) => section.items,
    ).filter((item: { kind: string }) => item.kind === "capitulo")
      .map((item: { description: string }) => item.description);

    expect(chapters).toContain("ALVENARIAS");
    expect(chapters).toContain("INSTALAÇÃO HIDRÁULICA");
    expect(chapters).toContain("INSTALAÇÕES ELÉCTRICAS");
    expect(chapters).toContain("SEGURANÇA ELECTRÓNICA");
    expect(chapters).not.toContain("BETÕES, AÇOS E COFRAGENS");
  });

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
    expect(workspaceResponse.statusCode).toBe(201);
    expect(workspaceResponse.json()).toEqual({
      document: expect.objectContaining({ currency: "MZN", documentType: "medicao" }),
      created: true,
    });
  });

  it("mantém a medição separada e cria um orçamento comercial a partir das quantidades", async () => {
    const { cookie, project } = await projectContext("MZN", "medicao");

    const workspaceResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/measurement-workspace`,
      headers: { cookie },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json()).toEqual({
      document: expect.objectContaining({ id: project.defaultDocumentId, documentType: "medicao" }),
      created: false,
    });

    const emptyBudgetResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/create-budget`,
      headers: { cookie },
    });
    expect(emptyBudgetResponse.statusCode).toBe(409);

    const summaryResponse = await app.inject({
      method: "GET",
      url: `/api/budget-documents/${project.defaultDocumentId}`,
      headers: { cookie },
    });
    const firstMeasuredItem = summaryResponse.json().sections
      .flatMap((section: { items: Array<{ children?: Array<{ id: string; kind: string }> }> }) => section.items)
      .flatMap((item: { children?: Array<{ id: string; kind: string }> }) => item.children ?? [])
      .find((item: { kind: string }) => item.kind === "item");
    expect(firstMeasuredItem).toBeTruthy();
    const quantityResponse = await app.inject({
      method: "PUT",
      url: `/api/line-items/${firstMeasuredItem.id}`,
      headers: { cookie },
      payload: { quantity: 1 },
    });
    expect(quantityResponse.statusCode).toBe(200);

    const budgetResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/create-budget`,
      headers: { cookie },
    });
    expect(budgetResponse.statusCode).toBe(201);
    expect(budgetResponse.json()).toEqual({
      document: expect.objectContaining({
        documentType: "orcamento",
        sourceMeasurementDocumentId: project.defaultDocumentId,
      }),
      created: true,
      revisionCreated: false,
    });

    const changedQuantityResponse = await app.inject({
      method: "PUT",
      url: `/api/line-items/${firstMeasuredItem.id}`,
      headers: { cookie },
      payload: { quantity: 2 },
    });
    expect(changedQuantityResponse.statusCode).toBe(200);

    const changedBudgetResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/create-budget`,
      headers: { cookie },
      payload: {},
    });
    expect(changedBudgetResponse.statusCode).toBe(409);
    expect(changedBudgetResponse.json()).toEqual(expect.objectContaining({ code: "MEASUREMENT_CHANGED" }));

    const revisionResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/create-budget`,
      headers: { cookie },
      payload: { createRevision: true },
    });
    expect(revisionResponse.statusCode).toBe(201);
    expect(revisionResponse.json()).toEqual({
      document: expect.objectContaining({ revision: "1", sourceMeasurementDocumentId: project.defaultDocumentId }),
      created: true,
      revisionCreated: true,
    });

    const documentsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-documents`,
      headers: { cookie },
    });
    expect(documentsResponse.statusCode).toBe(200);
    expect(documentsResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: project.defaultDocumentId, documentType: "medicao" }),
      expect.objectContaining({ documentType: "orcamento", sourceMeasurementDocumentId: project.defaultDocumentId }),
    ]));
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
