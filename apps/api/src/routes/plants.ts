import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, or, desc, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { plants, projects as projectTable, extractedRooms, extractedOpenings, extractedRebarSchedules, materials, plantReviewRequests, companies, users } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned, assertPlantOwned } from "../services/accessControl.js";
import { env } from "../env.js";
import { extractedSlabSchema, plantParseResultSchema, PLANT_DISCIPLINES, fixedSigo, structuralSummarySchema } from "@sigo/shared";
import { loadWorkChapterLibrary } from "../services/boqTemplate.js";
import { syncProjectPlantMeasurements } from "../services/plantMeasurementSync.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import {
  createPlantReviewRequest,
  maybeOpenPlantReviewAfterProcessing,
  PLANT_REVIEW_SLA_HOURS,
} from "../services/plantReviewRequests.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;
const clientPlantIdSchema = z.string().uuid();
// Manter alinhado com a geração estrutural do plant-service. O valor participa da
// chave de cache da BD; ao mudar a leitura de lajes por nível, análises antigas não
// podem ser reutilizadas silenciosamente em novos uploads do mesmo PDF.
const PLANT_PARSER_VERSION = "2026.08-openings-fix-2";
type PlantDetectionContext = { tags: string[]; parserVersion: string };

async function getPlantDetectionContext(companyId: string): Promise<PlantDetectionContext> {
  const chapters = await loadWorkChapterLibrary(companyId);
  const tags = [...new Set(chapters.flatMap((chapter) => chapter.detectionTags ?? []).map((tag) => tag.trim().toLocaleLowerCase("pt")).filter(Boolean))].sort();
  const rulesHash = createHash("sha256").update(JSON.stringify(tags)).digest("hex").slice(0, 10);
  return { tags, parserVersion: `${PLANT_PARSER_VERSION}-${rulesHash}` };
}

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
function plantServiceUnavailableMessage(): string {
  return env.isProduction
    ? "O leitor de plantas está temporariamente indisponível. Tente novamente dentro de momentos."
    : "O leitor de plantas não está a correr. Na raiz do projecto execute: npm run dev:plant";
}

async function fetchPlantService(form: FormData): Promise<Response> {
  try {
    return await fetch(`${env.plantServiceUrl}/parse-stream`, {
      method: "POST",
      body: form,
      headers: env.plantServiceToken ? { "X-Internal-Token": env.plantServiceToken } : undefined,
      // PDFs grandes podem demorar; sem timeout o job fica preso em "processando".
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("O leitor de plantas demorou demasiado a responder. Tente novamente ou use medição manual.");
    }
    throw new Error(plantServiceUnavailableMessage());
  }
}

export async function processPlantFile(plantId: string, buffer: Buffer, filename: string, suppliedContext?: PlantDetectionContext): Promise<void> {
  let detectionContext = suppliedContext;
  if (!detectionContext) {
    const [owner] = await db.select({ companyId: projectTable.companyId }).from(plants)
      .innerJoin(projectTable, eq(projectTable.id, plants.projectId)).where(eq(plants.id, plantId)).limit(1);
    if (!owner) throw new Error("Projecto da planta não encontrado");
    detectionContext = await getPlantDetectionContext(owner.companyId);
  }
  await db.update(plants).set({
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    parserVersion: detectionContext.parserVersion,
  }).where(eq(plants.id, plantId));
  await setPlantProgress(plantId, 20, "A preparar o PDF para leitura");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  form.append("detectionTags", JSON.stringify(detectionContext.tags));
  const response = await fetchPlantService(form);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401) throw new Error("Autenticação interna com o leitor de plantas falhou");
    throw new Error(
      detail.trim()
        ? `O leitor de plantas respondeu com erro: ${detail.slice(0, 240)}`
        : `O leitor de plantas respondeu com erro (${response.status})`,
    );
  }
  if (!response.body) throw new Error("O leitor de plantas não devolveu o fluxo de análise");

  await setPlantProgress(plantId, 28, "A iniciar leitura das páginas");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let parseResult: unknown;

  async function consumeLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "progress"; currentPage: number; totalPages: number }
      | { type: "stage"; progress: number; message: string }
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
    } else if (event.type === "stage") {
      await setPlantProgress(plantId, event.progress, event.message);
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
  await db.delete(extractedOpenings).where(eq(extractedOpenings.plantId, plantId));
  await db.delete(extractedRebarSchedules).where(eq(extractedRebarSchedules.plantId, plantId));

  if (parsed.rooms.length) {
    await db.insert(extractedRooms).values(
      parsed.rooms.map((r) => ({
        plantId,
        name: r.name,
        number: r.number,
        areaM2: fixedSigo(r.areaM2),
        page: r.page,
        floor: r.floor,
        perimeterM: r.perimeterM != null ? fixedSigo(r.perimeterM) : null,
      }))
    );
  }
  if (parsed.openings.length) {
    await db.insert(extractedOpenings).values(parsed.openings.map((opening) => ({
      plantId,
      kind: opening.kind,
      code: opening.code,
      designation: opening.designation,
      widthM: opening.widthM != null ? fixedSigo(opening.widthM) : null,
      heightM: opening.heightM != null ? fixedSigo(opening.heightM) : null,
      sillHeightM: opening.sillHeightM != null ? fixedSigo(opening.sillHeightM) : null,
      quantity: opening.quantity,
      floor: opening.floor,
      location: opening.location,
      material: opening.material,
      page: opening.page,
      confidence: opening.confidence.toString(),
      source: opening.source,
      needsConfirmation: opening.needsConfirmation,
    })));
  }
  if (parsed.rebarSchedules.length) {
    await db.insert(extractedRebarSchedules).values(
      parsed.rebarSchedules.map((r) => ({
        plantId,
        element: r.element,
        diameterMm: r.diameterMm.toString(),
        weightKg: fixedSigo(r.weightKg),
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
    processingProgress: 98,
    processingStage: "A actualizar as medições",
    processingUpdatedAt: new Date(),
    structuralSummary: parsed.structuralSummary ?? null,
    documentAnalysis: parsed.documentAnalysis,
    ...(detectedPrimaryDiscipline ? { discipline: detectedPrimaryDiscipline } : {}),
  }).where(eq(plants.id, plantId));
  const [owner] = await db.select({ projectId: plants.projectId }).from(plants).where(eq(plants.id, plantId)).limit(1);
  if (owner) await syncProjectPlantMeasurements(owner.projectId);
  await db.update(plants).set({
    processingStatus: "concluido",
    processingProgress: 100,
    processingStage: "Análise concluída",
    processingUpdatedAt: new Date(),
  }).where(eq(plants.id, plantId));
  await maybeOpenPlantReviewAfterProcessing(plantId).catch(() => undefined);
}

// A leitura nunca pertence ao ciclo de vida do pedido HTTP. A BD é a fila persistente:
// se a API reiniciar, os registos pendentes/processando são retomados no arranque.
const activePlantJobs = new Set<string>();

export function enqueuePlantProcessing(plantId: string, suppliedContext?: PlantDetectionContext): void {
  if (activePlantJobs.has(plantId)) return;
  activePlantJobs.add(plantId);
  setImmediate(() => {
    void (async () => {
      try {
        const [plant] = await db.select({ filePath: plants.filePath, originalFileName: plants.originalFileName })
          .from(plants).where(eq(plants.id, plantId)).limit(1);
        if (!plant) return;
        const buffer = await readFile(plant.filePath);
        await processPlantFile(plantId, buffer, plant.originalFileName ?? "planta.pdf", suppliedContext);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido a processar a planta";
        const [failed] = await db.update(plants).set({
          processingStatus: "erro",
          processingStage: "Análise interrompida",
          processingUpdatedAt: new Date(),
          errorMessage: message,
        }).where(eq(plants.id, plantId)).returning().catch(() => [undefined]);
        if (failed) {
          await createPlantReviewRequest({
            plantId,
            reason: "erro_processamento",
            gaps: [`Processamento interrompido: ${message}`],
            progressAtFailure: failed.processingProgress,
            errorMessage: message,
          }).catch(() => undefined);
        }
      } finally {
        activePlantJobs.delete(plantId);
      }
    })();
  });
}

export async function resumePlantProcessingJobs(): Promise<number> {
  const interrupted = await db.select({ id: plants.id }).from(plants).where(or(
    eq(plants.processingStatus, "pendente"),
    eq(plants.processingStatus, "processando"),
  ));
  if (interrupted.length) {
    await db.update(plants).set({
      processingStatus: "processando",
      processingStage: "Análise retomada em segundo plano",
      processingUpdatedAt: new Date(),
      errorMessage: null,
    }).where(or(eq(plants.processingStatus, "pendente"), eq(plants.processingStatus, "processando")));
    for (const plant of interrupted) enqueuePlantProcessing(plant.id);
  }
  return interrupted.length;
}

export async function plantRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/plants", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select().from(plants).where(eq(plants.projectId, projectId)).orderBy(plants.uploadedAt);
  });

  // Contexto consolidado do assistente: 4 consultas fixas, independentemente do número de PDFs.
  // Evita o padrão anterior em que o browser fazia três consultas adicionais por planta.
  app.get("/api/projects/:projectId/plants/details", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const projectPlants = await db.select().from(plants).where(eq(plants.projectId, projectId)).orderBy(plants.uploadedAt);
    const ids = projectPlants.map((plant) => plant.id);
    if (ids.length === 0) return [];
    const [rooms, openings, rebarSchedules] = await Promise.all([
      db.select().from(extractedRooms).where(inArray(extractedRooms.plantId, ids)),
      db.select().from(extractedOpenings).where(inArray(extractedOpenings.plantId, ids)),
      db.select().from(extractedRebarSchedules).where(inArray(extractedRebarSchedules.plantId, ids)),
    ]);
    return projectPlants.map((plant) => ({
      plant,
      rooms: rooms.filter((room) => room.plantId === plant.id),
      openings: openings.filter((opening) => opening.plantId === plant.id),
      rebarSchedules: rebarSchedules.filter((line) => line.plantId === plant.id),
    }));
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
    if (discipline !== "auto" && !(PLANT_DISCIPLINES as readonly string[]).includes(discipline)) {
      return reply.code(400).send({ error: "Disciplina inválida" });
    }

    const buffer = await data.toBuffer();
    // Confirma pelos bytes reais que é mesmo um PDF (assinatura "%PDF-") antes de gravar e
    // enviar ao plant-service — a extensão .pdf já é sempre a nossa própria (nunca vem do
    // filename do cliente), mas sem isto aceitava-se qualquer conteúdo com esse nome.
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) {
      return reply.code(400).send({ error: "Ficheiro inválido — só são aceites PDFs" });
    }
    const { assertPlantAnalysisQuota, recordUsage } = await import("../services/subscriptionEntitlements.js");
    // A quota só conta análises novas (cache da mesma empresa não consome limite).
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const detectionContext = await getPlantDetectionContext(companyId);
    // O mesmo conjunto de plantas é frequentemente reenviado ao corrigir a disciplina ou ao
    // repetir uma criação. Dentro da própria empresa, reutilizar uma análise concluída evita
    // novamente minutos de CPU sem partilhar dados entre clientes.
    const [cachedPlant] = await db
      .select({
        id: plants.id,
        discipline: plants.discipline,
        structuralSummary: plants.structuralSummary,
        documentAnalysis: plants.documentAnalysis,
      })
      .from(plants)
      .innerJoin(projectTable, eq(projectTable.id, plants.projectId))
      .where(and(
        eq(projectTable.companyId, companyId),
        eq(plants.fileHash, fileHash),
        eq(plants.parserVersion, detectionContext.parserVersion),
        eq(plants.processingStatus, "concluido"),
      ))
      .limit(1);
    const uploadsDir = path.join(env.uploadsDir, "plants");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}.pdf`;
    const filePath = path.join(uploadsDir, fileName);
    await writeFile(filePath, buffer);

    // Quota antes de gravar a planta — o contador mensal inclui plantas já na BD.
    if (!cachedPlant) {
      const plantQuota = await assertPlantAnalysisQuota(companyId);
      if (plantQuota) {
        return reply.code(403).send({
          error: plantQuota.error,
          code: plantQuota.code,
          upgradeHint: plantQuota.upgradeHint,
          actionPath: plantQuota.actionPath,
        });
      }
    }

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
        fileHash,
        parserVersion: detectionContext.parserVersion,
        processingStatus: "processando",
        processingProgress: 12,
        processingStage: "Ficheiro recebido e validado",
        processingStartedAt: new Date(),
        processingUpdatedAt: new Date(),
      })
      .returning();

    if (cachedPlant) {
      const [cachedRooms, cachedOpenings, cachedRebar] = await Promise.all([
        db.select().from(extractedRooms).where(eq(extractedRooms.plantId, cachedPlant.id)),
        db.select().from(extractedOpenings).where(eq(extractedOpenings.plantId, cachedPlant.id)),
        db.select().from(extractedRebarSchedules).where(eq(extractedRebarSchedules.plantId, cachedPlant.id)),
      ]);
      if (cachedRooms.length) {
        await db.insert(extractedRooms).values(cachedRooms.map(({ id: _id, plantId: _plantId, ...room }) => ({ ...room, plantId: plant.id })));
      }
      if (cachedRebar.length) {
        await db.insert(extractedRebarSchedules).values(cachedRebar.map(({ id: _id, plantId: _plantId, ...line }) => ({ ...line, plantId: plant.id })));
      }
      if (cachedOpenings.length) {
        await db.insert(extractedOpenings).values(cachedOpenings.map(({ id: _id, plantId: _plantId, ...opening }) => ({ ...opening, plantId: plant.id })));
      }
      const [reused] = await db.update(plants).set({
        discipline: cachedPlant.discipline,
        structuralSummary: cachedPlant.structuralSummary,
        documentAnalysis: cachedPlant.documentAnalysis,
        processingStatus: "concluido",
        processingProgress: 100,
        processingStage: "Análise reutilizada — ficheiro já validado",
        processingUpdatedAt: new Date(),
      }).where(eq(plants.id, plant.id)).returning();
      await syncProjectPlantMeasurements(projectId);
      return reply.code(201).send(reused);
    }

    await recordUsage(companyId, "plant_analysis");

    // O upload responde assim que o ficheiro fica gravado — a leitura do PDF corre em segundo
    // plano e o progresso é consultado via GET /api/plants/:id/status (já usado pelo frontend
    // para a barra de progresso). Antes disto, o pedido HTTP ficava aberto durante toda a
    // análise (por vezes minutos), o que em produção esbarra em timeouts do proxy/CloudPanel —
    // nunca esperar aqui pela leitura inteira antes de responder.
    enqueuePlantProcessing(plant.id, detectionContext);
    return reply.code(201).send(plant);
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
    enqueuePlantProcessing(id);
    const [updated] = await db.select().from(plants).where(eq(plants.id, id)).limit(1);
    return updated;
  });

  app.get("/api/plants/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    const [rooms, openings, rebarSchedules] = await Promise.all([
      db.select().from(extractedRooms).where(eq(extractedRooms.plantId, id)),
      db.select().from(extractedOpenings).where(eq(extractedOpenings.plantId, id)),
      db.select().from(extractedRebarSchedules).where(eq(extractedRebarSchedules.plantId, id)),
    ]);
    return { plant, rooms, openings, rebarSchedules };
  });

  app.post("/api/plants/:id/confirm-identity", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });
    const parsed = z.object({ confirmed: z.literal(true) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Confirme explicitamente que as disciplinas pertencem à mesma obra" });
    const analysis = plant.documentAnalysis;
    if (!analysis?.requiresIdentityConfirmation) return reply.code(409).send({ error: "Esta planta não tem conflito de identidade por confirmar" });
    if (analysis.identityConfirmed) return plant;
    const [updated] = await db.update(plants).set({
      documentAnalysis: { ...analysis, identityConfirmed: true },
    }).where(eq(plants.id, id)).returning();
    await recordAuditEvent({
      companyId,
      projectId: plant.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "plant",
      entityId: id,
      action: "identity_conflict.confirmed",
      before: { identityConfirmed: false, conflicts: analysis.identityConflicts },
      after: { identityConfirmed: true, conflicts: analysis.identityConflicts },
    });
    await syncProjectPlantMeasurements(plant.projectId);
    return updated;
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

  app.put("/api/plants/:id/slabs", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });
    const parsed = z.object({ slabs: z.array(extractedSlabSchema).max(50) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const slabs = parsed.data.slabs;
    const current = plant.structuralSummary ?? {
      footingsCount: 0,
      footingsAvgWidthCm: 0,
      footingsAvgLengthCm: 0,
      footingsAvgDepthCm: 0,
      columnsCount: 0,
      beamsCount: 0,
      beamsTotalLengthM: 0,
      beamsAvgWidthCm: 0,
      beamsAvgHeightCm: 0,
      beamsConcreteVolumeM3: 0,
      staircasesCount: 0,
      slabsCount: 0,
      slabsAvgThicknessCm: 0,
      totalSteelWeightKg: 0,
      footingsSteelWeightKg: 0,
      columnsSteelWeightKg: 0,
      beamsSteelWeightKg: 0,
      slabsSteelWeightKg: 0,
    };
    const structuralSummary = {
      ...current,
      slabs,
      slabsCount: slabs.length,
      slabsAvgThicknessCm: slabs.length ? slabs.reduce((sum, slab) => sum + slab.thicknessCm, 0) / slabs.length : 0,
      slabsSteelWeightKg: slabs.reduce(
        (sum, slab) => sum + Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0),
        0,
      ) || current.slabsSteelWeightKg || 0,
    };
    const [updated] = await db.update(plants).set({ structuralSummary }).where(eq(plants.id, id)).returning();
    return updated;
  });

  const openingInputSchema = z.object({
    kind: z.enum(["porta", "janela"]),
    code: z.string().trim().max(40).nullable().optional(),
    designation: z.string().trim().max(160).nullable().optional(),
    widthM: z.number().positive().max(20).nullable(),
    heightM: z.number().positive().max(10).nullable(),
    sillHeightM: z.number().min(0).max(10).nullable().optional(),
    quantity: z.number().int().positive().max(1000),
    floor: z.string().trim().max(100).nullable().optional(),
    location: z.enum(["interior", "exterior", "desconhecida"]),
    material: z.string().trim().max(120).nullable().optional(),
    materialId: z.string().uuid().nullable().optional(),
    technicalSpecification: z.string().trim().max(2000).nullable().optional(),
    page: z.number().int().positive().default(1),
    confirmed: z.boolean().default(true),
  });

  async function openingMaterialIsVisible(materialId: string | null | undefined, companyId: string) {
    if (!materialId) return true;
    const [material] = await db.select({ id: materials.id }).from(materials)
      .where(and(eq(materials.id, materialId), or(isNull(materials.companyId), eq(materials.companyId, companyId))))
      .limit(1);
    return Boolean(material);
  }

  app.post("/api/plants/:plantId/openings", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { plantId } = request.params as { plantId: string };
    const companyId = request.currentUser!.companyId!;
    const ownedPlant = await assertPlantOwned(plantId, companyId);
    if (!ownedPlant) return reply.code(404).send({ error: "Planta não encontrada" });
    const parsed = openingInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!await openingMaterialIsVisible(parsed.data.materialId, companyId)) return reply.code(400).send({ error: "Material não disponível no Catálogo" });
    const [created] = await db.insert(extractedOpenings).values({
      plantId,
      kind: parsed.data.kind,
      code: parsed.data.code || null,
      designation: parsed.data.designation || null,
      widthM: parsed.data.widthM != null ? fixedSigo(parsed.data.widthM) : null,
      heightM: parsed.data.heightM != null ? fixedSigo(parsed.data.heightM) : null,
      sillHeightM: parsed.data.sillHeightM != null ? fixedSigo(parsed.data.sillHeightM) : null,
      quantity: parsed.data.quantity,
      floor: parsed.data.floor || null,
      location: parsed.data.location,
      material: parsed.data.material || null,
      materialId: parsed.data.materialId || null,
      technicalSpecification: parsed.data.technicalSpecification || null,
      page: parsed.data.page,
      confidence: "1",
      source: "manual",
      needsConfirmation: !parsed.data.confirmed,
    }).returning();
    await syncProjectPlantMeasurements(ownedPlant.projectId);
    return reply.code(201).send(created);
  });

  app.put("/api/plants/:plantId/openings/:openingId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { plantId, openingId } = request.params as { plantId: string; openingId: string };
    const companyId = request.currentUser!.companyId!;
    const ownedPlant = await assertPlantOwned(plantId, companyId);
    if (!ownedPlant) return reply.code(404).send({ error: "Planta não encontrada" });
    const parsed = openingInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!await openingMaterialIsVisible(parsed.data.materialId, companyId)) return reply.code(400).send({ error: "Material não disponível no Catálogo" });
    const [updated] = await db.update(extractedOpenings).set({
      kind: parsed.data.kind,
      code: parsed.data.code || null,
      designation: parsed.data.designation || null,
      widthM: parsed.data.widthM != null ? fixedSigo(parsed.data.widthM) : null,
      heightM: parsed.data.heightM != null ? fixedSigo(parsed.data.heightM) : null,
      sillHeightM: parsed.data.sillHeightM != null ? fixedSigo(parsed.data.sillHeightM) : null,
      quantity: parsed.data.quantity,
      floor: parsed.data.floor || null,
      location: parsed.data.location,
      material: parsed.data.material || null,
      materialId: parsed.data.materialId || null,
      technicalSpecification: parsed.data.technicalSpecification || null,
      page: parsed.data.page,
      confidence: parsed.data.confirmed ? "1" : "0.5",
      source: parsed.data.confirmed ? "manual" : "geometria",
      needsConfirmation: !parsed.data.confirmed,
    }).where(and(eq(extractedOpenings.id, openingId), eq(extractedOpenings.plantId, plantId))).returning();
    if (!updated) return reply.code(404).send({ error: "Vão não encontrado" });
    await syncProjectPlantMeasurements(ownedPlant.projectId);
    return updated;
  });

  app.delete("/api/plants/:plantId/openings/:openingId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { plantId, openingId } = request.params as { plantId: string; openingId: string };
    const companyId = request.currentUser!.companyId!;
    const ownedPlant = await assertPlantOwned(plantId, companyId);
    if (!ownedPlant) return reply.code(404).send({ error: "Planta não encontrada" });
    const [deleted] = await db.delete(extractedOpenings)
      .where(and(eq(extractedOpenings.id, openingId), eq(extractedOpenings.plantId, plantId))).returning({ id: extractedOpenings.id });
    if (!deleted) return reply.code(404).send({ error: "Vão não encontrado" });
    await syncProjectPlantMeasurements(ownedPlant.projectId);
    return { ok: true };
  });

  // Pedido explícito (ou reabertura) para o super admin melhorar o motor de análise.
  app.post("/api/plants/:id/request-engine-review", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });
    const body = z.object({
      userNotes: z.string().trim().max(2000).optional(),
      gaps: z.array(z.string().trim().max(400)).max(40).optional(),
    }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const review = await createPlantReviewRequest({
      plantId: id,
      reason: plant.processingStatus === "erro" ? "erro_processamento" : "pedido_utilizador",
      requestedByUserId: request.currentUser!.id,
      gaps: body.data.gaps,
      progressAtFailure: plant.processingProgress,
      errorMessage: plant.errorMessage,
      userNotes: body.data.userNotes ?? null,
      forceNotify: true,
    });
    if (!review) return reply.code(500).send({ error: "Não foi possível registar o pedido de revisão" });
    return {
      review,
      message: `A equipa SIGO já recebeu este pedido. Respondemos em até ${PLANT_REVIEW_SLA_HOURS} horas e regularizamos a leitura da planta e do projecto.`,
      slaHours: PLANT_REVIEW_SLA_HOURS,
    };
  });

  app.get("/api/plants/:id/review-request", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });
    const [open] = await db
      .select()
      .from(plantReviewRequests)
      .where(and(
        eq(plantReviewRequests.plantId, id),
        inArray(plantReviewRequests.status, ["aberto", "em_analise"]),
      ))
      .orderBy(desc(plantReviewRequests.createdAt))
      .limit(1);
    return { review: open ?? null, slaHours: PLANT_REVIEW_SLA_HOURS };
  });

  // Formulário dedicado (fora do assistente) para preencher sapatas, pilares, lajes, compartimentos, etc.
  const manualRoomSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    number: z.string().trim().max(20).nullable().optional(),
    floor: z.string().trim().max(100).nullable().optional(),
    areaM2: z.number().positive().max(100_000),
    perimeterM: z.number().positive().max(10_000).nullable().optional(),
    page: z.number().int().positive().max(500).default(1),
  });

  app.put("/api/plants/:id/manual-data", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(id, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    const parsed = z.object({
      structuralSummary: structuralSummarySchema,
      rooms: z.array(manualRoomSchema).max(200),
      userNotes: z.string().trim().max(2000).optional(),
      requestEngineReview: z.boolean().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const summary = {
      ...parsed.data.structuralSummary,
      slabsCount: parsed.data.structuralSummary.slabs?.length ?? parsed.data.structuralSummary.slabsCount,
      slabsAvgThicknessCm: (parsed.data.structuralSummary.slabs?.length ?? 0)
        ? parsed.data.structuralSummary.slabs!.reduce((sum, slab) => sum + slab.thicknessCm, 0) / parsed.data.structuralSummary.slabs!.length
        : parsed.data.structuralSummary.slabsAvgThicknessCm,
    };

    const [updatedPlant] = await db.update(plants).set({
      structuralSummary: summary,
      // Se estava em erro, passa a concluído depois do preenchimento manual para desbloquear o fluxo.
      processingStatus: plant.processingStatus === "erro" ? "concluido" : plant.processingStatus,
      processingStage: plant.processingStatus === "erro" ? "Dados preenchidos manualmente" : plant.processingStage,
      processingProgress: plant.processingStatus === "erro" ? 100 : plant.processingProgress,
      errorMessage: plant.processingStatus === "erro" ? null : plant.errorMessage,
      processingUpdatedAt: new Date(),
    }).where(eq(plants.id, id)).returning();

    const existingRooms = await db.select().from(extractedRooms).where(eq(extractedRooms.plantId, id));
    const keepIds = new Set(parsed.data.rooms.map((room) => room.id).filter(Boolean) as string[]);
    for (const room of existingRooms) {
      if (!keepIds.has(room.id)) {
        await db.delete(extractedRooms).where(and(eq(extractedRooms.id, room.id), eq(extractedRooms.plantId, id)));
      }
    }

    const savedRooms = [];
    for (const room of parsed.data.rooms) {
      if (room.id && existingRooms.some((row) => row.id === room.id)) {
        const [updated] = await db.update(extractedRooms).set({
          name: room.name,
          number: room.number ?? null,
          floor: room.floor ?? null,
          areaM2: fixedSigo(room.areaM2),
          perimeterM: room.perimeterM != null ? fixedSigo(room.perimeterM) : null,
          page: room.page,
        }).where(and(eq(extractedRooms.id, room.id), eq(extractedRooms.plantId, id))).returning();
        if (updated) savedRooms.push(updated);
      } else {
        const [created] = await db.insert(extractedRooms).values({
          plantId: id,
          name: room.name,
          number: room.number ?? null,
          floor: room.floor ?? null,
          areaM2: fixedSigo(room.areaM2),
          perimeterM: room.perimeterM != null ? fixedSigo(room.perimeterM) : null,
          page: room.page,
        }).returning();
        if (created) savedRooms.push(created);
      }
    }

    await syncProjectPlantMeasurements(plant.projectId);

    let review = null;
    if (parsed.data.requestEngineReview !== false) {
      review = await createPlantReviewRequest({
        plantId: id,
        reason: plant.processingStatus === "erro" ? "erro_processamento" : "extraccao_incompleta",
        requestedByUserId: request.currentUser!.id,
        gaps: [
          "Utilizador preencheu dados manuais enquanto a equipa melhora o motor.",
          ...(parsed.data.userNotes ? [parsed.data.userNotes] : []),
        ],
        progressAtFailure: plant.processingProgress,
        errorMessage: plant.errorMessage,
        userNotes: parsed.data.userNotes ?? null,
      });
    }

    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "plant",
      entityId: id,
      action: "manual_data.save",
      after: { rooms: savedRooms.length, structuralSummary: summary },
    });

    return {
      plant: updatedPlant,
      rooms: savedRooms,
      review,
      message: `Dados guardados. A equipa SIGO continua a melhorar a leitura automática e responde em até ${PLANT_REVIEW_SLA_HOURS} horas.`,
      slaHours: PLANT_REVIEW_SLA_HOURS,
    };
  });

  app.get("/api/admin/plant-reviews", { preHandler: requireRole("super_admin") }, async (request) => {
    const query = z.object({
      status: z.enum(["aberto", "em_analise", "resolvido", "todos"]).default("aberto"),
    }).safeParse(request.query ?? {});
    const status = query.success ? query.data.status : "aberto";
    const base = db
      .select({
        review: plantReviewRequests,
        plantFileName: plants.originalFileName,
        plantStatus: plants.processingStatus,
        plantProgress: plants.processingProgress,
        projectName: projectTable.name,
        companyName: companies.name,
        requesterName: users.name,
        requesterEmail: users.email,
      })
      .from(plantReviewRequests)
      .innerJoin(plants, eq(plants.id, plantReviewRequests.plantId))
      .innerJoin(projectTable, eq(projectTable.id, plantReviewRequests.projectId))
      .innerJoin(companies, eq(companies.id, plantReviewRequests.companyId))
      .leftJoin(users, eq(users.id, plantReviewRequests.requestedByUserId));
    const rows = status === "todos"
      ? await base.orderBy(desc(plantReviewRequests.createdAt)).limit(100)
      : await base.where(eq(plantReviewRequests.status, status)).orderBy(desc(plantReviewRequests.createdAt)).limit(100);

    return rows.map((row) => ({
      ...row.review,
      plantFileName: row.plantFileName,
      plantStatus: row.plantStatus,
      plantProgress: row.plantProgress,
      projectName: row.projectName,
      companyName: row.companyName,
      requesterName: row.requesterName,
      requesterEmail: row.requesterEmail,
      pdfUrl: `/api/files/plants/${row.review.plantId}`,
    }));
  });

  app.patch("/api/admin/plant-reviews/:id", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({
      status: z.enum(["aberto", "em_analise", "resolvido"]),
      adminNotes: z.string().trim().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [updated] = await db
      .update(plantReviewRequests)
      .set({
        status: parsed.data.status,
        adminNotes: parsed.data.adminNotes ?? undefined,
        resolvedAt: parsed.data.status === "resolvido" ? new Date() : null,
      })
      .where(eq(plantReviewRequests.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Pedido não encontrado" });
    return updated;
  });
}
