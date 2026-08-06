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
    const company = await createCompany("Empresa Medições Orçamento");
    await createUser(company.id, "orcamentista", "medicoes-orc@test.local");
    await createUser(company.id, "admin_empresa", "medicoes-admin@test.local");
    const cookie = await loginCookie(app, "medicoes-orc@test.local");
    const adminCookie = await loginCookie(app, "medicoes-admin@test.local");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Obra de Teste", currency: "MZN", projectType: "medicao" },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json() as { id: string; defaultDocumentId: string };

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

    const submitResponse = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${project.defaultDocumentId}/status`,
      headers: { cookie },
      payload: { status: "submetido" },
    });
    expect(submitResponse.statusCode).toBe(200);
    const approveResponse = await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${project.defaultDocumentId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "aprovado" },
    });
    expect(approveResponse.statusCode).toBe(200);

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
      scenarioCreated: false,
    });

    // Uma medição aprovada fica bloqueada para edição (sem transição de volta a rascunho) —
    // para quantidades diferentes o fluxo esperado é duplicar a medição, não reabrir esta.
    const changedQuantityResponse = await app.inject({
      method: "PUT",
      url: `/api/line-items/${firstMeasuredItem.id}`,
      headers: { cookie },
      payload: { quantity: 2 },
    });
    expect(changedQuantityResponse.statusCode).toBe(409);

    // Repetir create-budget sem alterações devolve o mesmo orçamento (idempotente pelo fingerprint).
    const repeatBudgetResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/create-budget`,
      headers: { cookie },
      payload: {},
    });
    expect(repeatBudgetResponse.statusCode).toBe(200);
    expect(repeatBudgetResponse.json()).toEqual(expect.objectContaining({ created: false, revisionCreated: false }));

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

  it("duplica uma medição aprovada numa cópia editável em rascunho, sem afectar a original", async () => {
    const company = await createCompany("Empresa Duplicação Medição");
    await createUser(company.id, "orcamentista", "duplicar-orc@test.local");
    await createUser(company.id, "admin_empresa", "duplicar-admin@test.local");
    const cookie = await loginCookie(app, "duplicar-orc@test.local");
    const adminCookie = await loginCookie(app, "duplicar-admin@test.local");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Obra Duplicação", currency: "MZN", projectType: "medicao" },
    });
    const project = projectResponse.json() as { id: string; defaultDocumentId: string };

    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/measurement-workspace`,
      headers: { cookie },
    });
    const summaryResponse = await app.inject({
      method: "GET",
      url: `/api/budget-documents/${project.defaultDocumentId}`,
      headers: { cookie },
    });
    const firstMeasuredItem = summaryResponse.json().sections
      .flatMap((section: { items: Array<{ children?: Array<{ id: string; kind: string }> }> }) => section.items)
      .flatMap((item: { children?: Array<{ id: string; kind: string }> }) => item.children ?? [])
      .find((item: { kind: string }) => item.kind === "item");
    await app.inject({
      method: "PUT",
      url: `/api/line-items/${firstMeasuredItem.id}`,
      headers: { cookie },
      payload: { quantity: 5 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${project.defaultDocumentId}/status`,
      headers: { cookie },
      payload: { status: "submetido" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/budget-documents/${project.defaultDocumentId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "aprovado" },
    });

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/duplicate`,
      headers: { cookie },
    });
    expect(duplicateResponse.statusCode).toBe(201);
    const duplicated = duplicateResponse.json() as { document: { id: string; status: string; documentType: string; title: string }; sourceDocumentId: string };
    expect(duplicated.document.status).toBe("rascunho");
    expect(duplicated.document.documentType).toBe("medicao");
    expect(duplicated.sourceDocumentId).toBe(project.defaultDocumentId);
    expect(duplicated.document.id).not.toBe(project.defaultDocumentId);

    // A cópia é livremente editável (está em rascunho), ao contrário da original aprovada.
    const copySummaryResponse = await app.inject({
      method: "GET",
      url: `/api/budget-documents/${duplicated.document.id}`,
      headers: { cookie },
    });
    const copiedItem = copySummaryResponse.json().sections
      .flatMap((section: { items: Array<{ children?: Array<{ id: string; kind: string; quantity: string | null }> }> }) => section.items)
      .flatMap((item: { children?: Array<{ id: string; kind: string; quantity: string | null }> }) => item.children ?? [])
      .find((item: { kind: string }) => item.kind === "item");
    expect(Number(copiedItem.quantity)).toBe(5);
    const editCopyResponse = await app.inject({
      method: "PUT",
      url: `/api/line-items/${copiedItem.id}`,
      headers: { cookie },
      payload: { quantity: 8 },
    });
    expect(editCopyResponse.statusCode).toBe(200);

    // A medição original continua bloqueada e com a quantidade inalterada.
    const originalStillLockedResponse = await app.inject({
      method: "PUT",
      url: `/api/line-items/${firstMeasuredItem.id}`,
      headers: { cookie },
      payload: { quantity: 99 },
    });
    expect(originalStillLockedResponse.statusCode).toBe(409);
  });

  it("recusa duplicar um orçamento pelo endpoint exclusivo de medições", async () => {
    const { cookie, project } = await projectContext("MZN", "orcamento");
    const response = await app.inject({
      method: "POST",
      url: `/api/budget-documents/${project.defaultDocumentId}/duplicate`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(409);
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
