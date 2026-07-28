import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { plants, extractedRooms, extractedRebarSchedules } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned, assertPlantOwned } from "../services/accessControl.js";
import { env } from "../env.js";
import { plantParseResultSchema, PLANT_DISCIPLINES } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;
const clientPlantIdSchema = z.string().uuid();

async function setPlantProgress(
  plantId: string,
  progress: number,
  stage: string,
  pages?: { currentPage: number; totalPages: number },
) {
  await db.update(plants).set({
    processingProgress: Math.max(0, Math.min(100, Math.round(progress))),
    processingStage: stage,
    processingCurrentPage: pages?.currentPage,
    processingTotalPages: pages?.totalPages,
    processingUpdatedAt: new Date(),
  }).where(eq(plants.id, plantId));
}

// Chama o plant-service e grava o resultado — partilhado entre o upload inicial e o
// reprocessamento (mesmo ficheiro em disco, útil quando a lógica de extracção melhora e não se
// quer obrigar o utilizador a carregar o PDF outra vez).
export async function processPlantFile(plantId: string, buffer: Buffer, filename: string): Promise<void> {
  await setPlantProgress(plantId, 20, "A preparar o PDF para leitura");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  const response = await fetch(`${env.plantServiceUrl}/parse-stream`, {
    method: "POST",
    body: form,
    headers: env.plantServiceToken ? { "X-Internal-Token": env.plantServiceToken } : undefined,
  });
  if (!response.ok) throw new Error(`plant-service devolveu ${response.status}`);
  if (!response.body) throw new Error("plant-service não devolveu o fluxo de análise");

  await setPlantProgress(plantId, 28, "A iniciar leitura das páginas");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let parseResult: unknown;

  async function consumeLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "progress"; currentPage: number; totalPages: number }
      | { type: "result"; data: unknown }
      | { type: "error"; message: string };
    if (event.type === "progress") {
      const pageProgress = event.totalPages > 0 ? event.currentPage / event.totalPages : 0;
      await setPlantProgress(
        plantId,
        30 + pageProgress * 55,
        `A ler página ${event.currentPage} de ${event.totalPages}`,
        { currentPage: event.currentPage, totalPages: event.totalPages },
      );
    } else if (event.type === "result") {
      parseResult = event.data;
    } else {
      throw new Error(event.message || "Falha no serviço de análise");
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }
  if (pending.trim()) await consumeLine(pending);
  if (!parseResult) throw new Error("plant-service terminou sem devolver resultados");
  const parsed = plantParseResultSchema.parse(parseResult);

  await setPlantProgress(
    plantId,
    88,
    parsed.documentAnalysis.isMultiDiscipline
      ? `A separar ${parsed.documentAnalysis.sections.length} secções do projecto`
      : "A organizar os dados encontrados",
  );

  await db.delete(extractedRooms).where(eq(extractedRooms.plantId, plantId));
  await db.delete(extractedRebarSchedules).where(eq(extractedRebarSchedules.plantId, plantId));

  if (parsed.rooms.length) {
    await db.insert(extractedRooms).values(
      parsed.rooms.map((r) => ({
        plantId,
        name: r.name,
        number: r.number,
        areaM2: r.areaM2.toString(),
        page: r.page,
        floor: r.floor,
      }))
    );
  }
  if (parsed.rebarSchedules.length) {
    await db.insert(extractedRebarSchedules).values(
      parsed.rebarSchedules.map((r) => ({
        plantId,
        element: r.element,
        diameterMm: r.diameterMm.toString(),
        weightKg: r.weightKg.toString(),
        page: r.page,
      }))
    );
  }

  await setPlantProgress(plantId, 96, "A validar compartimentos e elementos estruturais");
  const detectedDisciplines = new Set(parsed.documentAnalysis.sections.map((section) => section.discipline));
  const detectedPrimaryDiscipline = detectedDisciplines.has("arquitectura")
    ? "arquitectura"
    : detectedDisciplines.has("estrutura")
      ? "estrutura"
      : undefined;
  await db.update(plants).set({
    processingStatus: "concluido",
    processingProgress: 100,
    processingStage: "Análise concluída",
    processingUpdatedAt: new Date(),
    structuralSummary: parsed.structuralSummary ?? null,
    documentAnalysis: parsed.documentAnalysis,
    ...(detectedPrimaryDiscipline ? { discipline: detectedPrimaryDiscipline } : {}),
  }).where(eq(plants.id, plantId));
}

export async function plantRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/plants", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select().from(plants).where(eq(plants.projectId, projectId)).orderBy(plants.uploadedAt);
  });

  app.post("/api/projects/:projectId/plants", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const disciplineField = data.fields.discipline;
    const clientPlantIdField = data.fields.clientPlantId;
    const discipline = typeof disciplineField === "object" && "value" in disciplineField ? String(disciplineField.value) : "arquitectura";
    const clientPlantIdValue = typeof clientPlantIdField === "object" && "value" in clientPlantIdField ? String(clientPlantIdField.value) : "";
    const parsedClientPlantId = clientPlantIdSchema.safeParse(clientPlantIdValue);
    if (!parsedClientPlantId.success) return reply.code(400).send({ error: "Identificador de acompanhamento inválido" });
    if (discipline !== "auto" && !PLANT_DISCIPLINES.includes(discipline as any)) {
      return reply.code(400).send({ error: "Disciplina inválida" });
    }

    const buffer = await data.toBuffer();
    // Confirma pelos bytes reais que é mesmo um PDF (assinatura "%PDF-") antes de gravar e
    // enviar ao plant-service — a extensão .pdf já é sempre a nossa própria (nunca vem do
    // filename do cliente), mas sem isto aceitava-se qualquer conteúdo com esse nome.
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) {
      return reply.code(400).send({ error: "Ficheiro inválido — só são aceites PDFs" });
    }
    const uploadsDir = path.join(env.uploadsDir, "plants");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}.pdf`;
    const filePath = path.join(uploadsDir, fileName);
    await writeFile(filePath, buffer);

    const [plant] = await db
      .insert(plants)
      .values({
        id: parsedClientPlantId.data,
        projectId,
        // "auto" é modo de entrada, não uma disciplina física da BD. A classificação final
        // corrige este valor depois da leitura e guarda todas as secções em documentAnalysis.
        discipline: discipline === "auto" ? "arquitectura" : discipline as (typeof PLANT_DISCIPLINES)[number],
        filePath,
        originalFileName: data.filename,
        processingStatus: "processando",
        processingProgress: 12,
        processingStage: "Ficheiro recebido e validado",
        processingStartedAt: new Date(),
        processingUpdatedAt: new Date(),
      })
      .returning();

    try {
      await processPlantFile(plant.id, buffer, data.filename);
      const [updated] = await db.select().from(plants).where(eq(plants.id, plant.id)).limit(1);
      return reply.code(201).send(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido a processar a planta";
      await db.update(plants).set({ processingStatus: "erro", processingStage: "Análise interrompida", processingUpdatedAt: new Date(), errorMessage: message }).where(eq(plants.id, plant.id));
      return reply.code(502).send({ error: `Falha ao processar a planta: ${message}` });
    }
  });

  // Reprocessa o mesmo ficheiro já guardado (sem carregar de novo) — útil depois de uma melhoria
  // na extracção (ex: identificação de pisos), para os projectos já carregados passarem a
  // beneficiar da correcção sem o utilizador ter de encontrar e reenviar o PDF outra vez.
  app.post("/api/plants/:id/reprocess", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    await db.update(plants).set({
      processingStatus: "processando",
      processingProgress: 5,
      processingStage: "A reiniciar a análise",
      processingCurrentPage: null,
      processingTotalPages: null,
      processingStartedAt: new Date(),
      processingUpdatedAt: new Date(),
      errorMessage: null,
    }).where(eq(plants.id, id));
    try {
      const buffer = await readFile(plant.filePath);
      await processPlantFile(id, buffer, plant.originalFileName ?? "planta.pdf");
      const [updated] = await db.select().from(plants).where(eq(plants.id, id)).limit(1);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido a reprocessar a planta";
      await db.update(plants).set({ processingStatus: "erro", processingStage: "Análise interrompida", processingUpdatedAt: new Date(), errorMessage: message }).where(eq(plants.id, id));
      return reply.code(502).send({ error: `Falha ao reprocessar a planta: ${message}` });
    }
  });

  app.get("/api/plants/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    const [rooms, rebarSchedules] = await Promise.all([
      db.select().from(extractedRooms).where(eq(extractedRooms.plantId, id)),
      db.select().from(extractedRebarSchedules).where(eq(extractedRebarSchedules.plantId, id)),
    ]);
    return { plant, rooms, rebarSchedules };
  });

  app.get("/api/plants/:id/status", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta ainda não disponível" });
    return {
      id: plant.id,
      processingStatus: plant.processingStatus,
      processingProgress: plant.processingProgress,
      processingStage: plant.processingStage,
      processingCurrentPage: plant.processingCurrentPage,
      processingTotalPages: plant.processingTotalPages,
      processingStartedAt: plant.processingStartedAt,
      processingUpdatedAt: plant.processingUpdatedAt,
      errorMessage: plant.errorMessage,
    };
  });

  app.delete("/api/plants/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    await db.delete(plants).where(eq(plants.id, id));
    // O ficheiro físico não tem cascade na BD (não é uma linha) — apagar depois de confirmar
    // que o registo foi removido; se o ficheiro já não existir no disco, não é um erro a reportar.
    await unlink(plant.filePath).catch(() => {});
    return { ok: true };
  });

  const updateRoomFloorSchema = z.object({ floor: z.string().min(1).nullable() });

  // Reatribuição do piso de um compartimento no ecrã de confirmação — a detecção automática
  // (a partir do texto da folha) nem sempre acerta em casos ambíguos (ex: uma casa de banho
  // partilhada entre a casa principal e um anexo), por isso fica sempre corrigível antes de o
  // compartimento entrar no Assistente de Medições.
  app.patch("/api/plants/:plantId/rooms/:roomId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { plantId, roomId } = request.params as { plantId: string; roomId: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(plantId, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    const parsed = updateRoomFloorSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [updated] = await db
      .update(extractedRooms)
      .set({ floor: parsed.data.floor })
      .where(and(eq(extractedRooms.id, roomId), eq(extractedRooms.plantId, plantId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Compartimento não encontrado" });
    return updated;
  });
}
