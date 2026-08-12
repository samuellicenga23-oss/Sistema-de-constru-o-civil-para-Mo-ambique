import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql as drizzleSql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { materials, projects, scheduleTasks, siteDiaryEntries, siteDiaryTaskProgress, stockMovements } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { assertApprovedOrcamentoForSite } from "../services/siteGate.js";
import { detectImageExtension } from "../services/imageValidation.js";
import { buildSiteDiaryPdf } from "../services/siteDiaryExport.js";
import { loadCompanyBrand } from "../services/companyBrand.js";
import { env } from "../env.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const entrySchema = z.object({
  date: z.string().min(1),
  weather: z.string().optional(),
  workersPresent: z.number().int().min(0).optional(),
  equipmentPresent: z.string().optional(),
  workDone: z.string().min(1),
  materialsReceived: z.string().optional(),
  materialsConsumed: z.string().optional(),
  visitors: z.string().optional(),
  inspectorInstructions: z.string().optional(),
  incidents: z.string().optional(),
  decisions: z.string().optional(),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
  taskProgress: z.array(z.object({ taskId: z.string().uuid(), progressPercent: z.number().min(0).max(100), notes: z.string().optional() })).optional(),
  consumptions: z.array(z.object({ materialId: z.string().uuid(), quantity: z.number().positive(), notes: z.string().optional() })).optional(),
});
const entryUpdateSchema = entrySchema.partial();

// Exportado para uso em routes/files.ts (serve as fotos do diário, agora autenticadas).
export async function assertEntryOwned(entryId: string, companyId: string) {
  const [entry] = await db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.id, entryId)).limit(1);
  if (!entry) return null;
  const project = await assertProjectOwned(entry.projectId, companyId);
  return project ? entry : null;
}

export async function siteDiaryRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/site-diary", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const entries = await db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.projectId, projectId)).orderBy(desc(siteDiaryEntries.date));
    if (!entries.length) return [];
    const entryIds = entries.map((entry) => entry.id);
    const [progressRows, consumptionRows] = await Promise.all([
      db
        .select({ row: siteDiaryTaskProgress, taskName: scheduleTasks.name, taskCode: scheduleTasks.code })
        .from(siteDiaryTaskProgress)
        .innerJoin(scheduleTasks, eq(siteDiaryTaskProgress.scheduleTaskId, scheduleTasks.id))
        .where(inArray(siteDiaryTaskProgress.diaryEntryId, entryIds)),
      db
        .select({ row: stockMovements, materialName: materials.name, unit: materials.unit })
        .from(stockMovements)
        .innerJoin(materials, eq(stockMovements.materialId, materials.id))
        .where(and(inArray(stockMovements.diaryEntryId, entryIds), eq(stockMovements.type, "saida"))),
    ]);
    return entries.map((entry) => ({
      ...entry,
      taskProgress: progressRows.filter(({ row }) => row.diaryEntryId === entry.id).map(({ row, ...meta }) => ({ ...row, ...meta, progressPercent: Number(row.progressPercent) })),
      consumptions: consumptionRows.filter(({ row }) => row.diaryEntryId === entry.id).map(({ row, ...meta }) => ({ ...row, ...meta, quantity: Number(row.quantity) })),
    }));
  });

  app.post("/api/projects/:projectId/site-diary", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const gate = await assertApprovedOrcamentoForSite(projectId, companyIdOf(request));
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });

    const parsed = entrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { taskProgress = [], consumptions = [], ...entryData } = parsed.data;
    if (taskProgress.length) {
      const taskIds = Array.from(new Set(taskProgress.map((item) => item.taskId)));
      if (taskIds.length !== taskProgress.length) return reply.code(400).send({ error: "A mesma actividade foi indicada mais de uma vez" });
      const tasks = await db.select().from(scheduleTasks).where(inArray(scheduleTasks.id, taskIds));
      if (tasks.length !== taskIds.length || tasks.some((task) => task.projectId !== projectId)) {
        return reply.code(400).send({ error: "Uma das tarefas não pertence ao cronograma desta obra" });
      }
    }
    if (consumptions.length) {
      const companyId = companyIdOf(request);
      const materialIds = Array.from(new Set(consumptions.map((item) => item.materialId)));
      const visibleMaterials = await db.select().from(materials).where(and(inArray(materials.id, materialIds), or(isNull(materials.companyId), eq(materials.companyId, companyId))));
      if (visibleMaterials.length !== materialIds.length) return reply.code(400).send({ error: "Um dos materiais não existe no Catálogo" });
    }

    const result = await db.transaction(async (tx) => {
      if (consumptions.length) {
        const materialIds = Array.from(new Set(consumptions.map((item) => item.materialId))).sort();
        // Bloqueia por ordem fixa (material ordenado) para nunca cruzar com outro registo do
        // Diário a bloquear os mesmos materiais em ordem inversa — evita deadlock entre pedidos
        // concorrentes. Mesma protecção que /stock-movements usa para saídas manuais.
        for (const materialId of materialIds) {
          await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${`${projectId}:${materialId}`}))`);
        }
        const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.projectId, projectId), inArray(stockMovements.materialId, materialIds)));
        for (const materialId of materialIds) {
          const available = movements.filter((movement) => movement.materialId === materialId).reduce((sum, movement) => sum + (movement.type === "entrada" ? Number(movement.quantity) : -Number(movement.quantity)), 0);
          const requested = consumptions.filter((item) => item.materialId === materialId).reduce((sum, item) => sum + item.quantity, 0);
          if (requested > available + 0.0001) {
            const material = await tx.select().from(materials).where(eq(materials.id, materialId)).limit(1);
            return { error: `Stock insuficiente de ${material[0]?.name ?? "material"}: disponível ${available.toFixed(2)} ${material[0]?.unit ?? ""}` } as const;
          }
        }
      }

      const [row] = await tx
        .insert(siteDiaryEntries)
        .values({ ...entryData, projectId, createdByUserId: request.currentUser!.id })
        .returning();
      if (taskProgress.length) await tx.insert(siteDiaryTaskProgress).values(taskProgress.map((item) => ({
        diaryEntryId: row.id,
        scheduleTaskId: item.taskId,
        progressPercent: item.progressPercent.toString(),
        notes: item.notes,
      })));
      if (consumptions.length) await tx.insert(stockMovements).values(consumptions.map((item) => ({
        projectId,
        materialId: item.materialId,
        type: "saida" as const,
        quantity: item.quantity.toString(),
        notes: item.notes ?? "Consumo registado no Diário de Obra",
        diaryEntryId: row.id,
        createdByUserId: request.currentUser!.id,
        date: entryData.date,
      })));
      return { row } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId, actorUserId: request.currentUser!.id,
      entityType: "site_diary", entityId: result.row.id, action: "created",
      after: { date: result.row.date, workDone: result.row.workDone },
      metadata: { taskProgressCount: taskProgress.length, consumptionCount: consumptions.length },
    });
    return reply.code(201).send(result.row);
  });

  app.put("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    const parsed = entryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { taskProgress, consumptions, ...entryData } = parsed.data;

    if (taskProgress) {
      const taskIds = Array.from(new Set(taskProgress.map((item) => item.taskId)));
      if (taskIds.length !== taskProgress.length) return reply.code(400).send({ error: "A mesma actividade foi indicada mais de uma vez" });
      if (taskIds.length) {
        const tasks = await db.select().from(scheduleTasks).where(inArray(scheduleTasks.id, taskIds));
        if (tasks.length !== taskIds.length || tasks.some((task) => task.projectId !== entry.projectId)) {
          return reply.code(400).send({ error: "Uma das actividades não pertence ao cronograma desta obra" });
        }
      }
    }
    if (consumptions) {
      const materialIds = Array.from(new Set(consumptions.map((item) => item.materialId)));
      if (materialIds.length) {
        const visibleMaterials = await db.select().from(materials).where(and(inArray(materials.id, materialIds), or(isNull(materials.companyId), eq(materials.companyId, companyIdOf(request)))));
        if (visibleMaterials.length !== materialIds.length) return reply.code(400).send({ error: "Um dos materiais não existe no Catálogo" });
      }
    }

    const result = await db.transaction(async (tx) => {
      if (consumptions) {
        const previous = await tx.select().from(stockMovements).where(and(eq(stockMovements.diaryEntryId, id), eq(stockMovements.type, "saida")));
        const materialIds = Array.from(new Set([...previous.map((item) => item.materialId), ...consumptions.map((item) => item.materialId)])).sort();
        for (const materialId of materialIds) {
          await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${`${entry.projectId}:${materialId}`}))`);
        }
        if (materialIds.length) {
          const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.projectId, entry.projectId), inArray(stockMovements.materialId, materialIds)));
          for (const materialId of materialIds) {
            const currentBalance = movements.filter((movement) => movement.materialId === materialId).reduce((sum, movement) => sum + (movement.type === "entrada" ? Number(movement.quantity) : -Number(movement.quantity)), 0);
            const restoredFromThisEntry = previous.filter((movement) => movement.materialId === materialId).reduce((sum, movement) => sum + Number(movement.quantity), 0);
            const requested = consumptions.filter((item) => item.materialId === materialId).reduce((sum, item) => sum + item.quantity, 0);
            const available = currentBalance + restoredFromThisEntry;
            if (requested > available + 0.0001) {
              const material = await tx.select().from(materials).where(eq(materials.id, materialId)).limit(1);
              return { error: `Stock insuficiente de ${material[0]?.name ?? "material"}: disponível ${available.toFixed(2)} ${material[0]?.unit ?? ""}` } as const;
            }
          }
        }
        await tx.delete(stockMovements).where(and(eq(stockMovements.diaryEntryId, id), eq(stockMovements.type, "saida")));
        if (consumptions.length) await tx.insert(stockMovements).values(consumptions.map((item) => ({
          projectId: entry.projectId,
          materialId: item.materialId,
          type: "saida" as const,
          quantity: item.quantity.toString(),
          notes: item.notes ?? "Consumo registado no Diário de Obra",
          diaryEntryId: id,
          createdByUserId: request.currentUser!.id,
          date: entryData.date ?? entry.date,
        })));
      }
      if (taskProgress) {
        await tx.delete(siteDiaryTaskProgress).where(eq(siteDiaryTaskProgress.diaryEntryId, id));
        if (taskProgress.length) await tx.insert(siteDiaryTaskProgress).values(taskProgress.map((item) => ({
          diaryEntryId: id,
          scheduleTaskId: item.taskId,
          progressPercent: item.progressPercent.toString(),
          notes: item.notes,
        })));
      }
      const [row] = await tx.update(siteDiaryEntries).set(entryData).where(eq(siteDiaryEntries.id, id)).returning();
      return { row } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId: entry.projectId, actorUserId: request.currentUser!.id,
      entityType: "site_diary", entityId: id, action: "corrected",
      before: { date: entry.date, workDone: entry.workDone },
      after: { date: result.row.date, workDone: result.row.workDone },
      metadata: { taskProgressUpdated: taskProgress !== undefined, consumptionsUpdated: consumptions !== undefined },
    });
    return result.row;
  });

  app.delete("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return { ok: true };
    await db.delete(siteDiaryEntries).where(eq(siteDiaryEntries.id, id));
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId: entry.projectId, actorUserId: request.currentUser!.id,
      entityType: "site_diary", entityId: id, action: "deleted",
      before: { date: entry.date, workDone: entry.workDone },
    });
    return { ok: true };
  });

  app.post("/api/site-diary/:id/photos", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const buffer = await data.toBuffer();
    const ext = detectImageExtension(buffer);
    if (!ext) return reply.code(400).send({ error: "Ficheiro inválido — só são aceites imagens PNG, JPG, WEBP ou GIF" });

    const uploadsDir = path.join(env.uploadsDir, "site-diary");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    await writeFile(path.join(uploadsDir, fileName), buffer);
    // Rota autenticada (routes/files.ts), não a antiga /uploads/ pública — a foto só é
    // acessível a quem tiver sessão na empresa dona do registo do diário.
    const photoUrl = `/api/files/site-diary/${id}/${fileName}`;

    const [row] = await db
      .update(siteDiaryEntries)
      .set({ photoUrls: [...entry.photoUrls, photoUrl] })
      .where(eq(siteDiaryEntries.id, id))
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/api/site-diary/:id/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });
    const [project] = await db.select().from(projects).where(eq(projects.id, entry.projectId)).limit(1);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const [progressRows, consumptionRows] = await Promise.all([
      db.select({ code: scheduleTasks.code, name: scheduleTasks.name, progressPercent: siteDiaryTaskProgress.progressPercent, notes: siteDiaryTaskProgress.notes }).from(siteDiaryTaskProgress).innerJoin(scheduleTasks, eq(siteDiaryTaskProgress.scheduleTaskId, scheduleTasks.id)).where(eq(siteDiaryTaskProgress.diaryEntryId, id)),
      db.select({ name: materials.name, unit: materials.unit, quantity: stockMovements.quantity, notes: stockMovements.notes }).from(stockMovements).innerJoin(materials, eq(stockMovements.materialId, materials.id)).where(eq(stockMovements.diaryEntryId, id)),
    ]);
    const buffer = await buildSiteDiaryPdf(
      entry,
      project,
      {
        progress: progressRows.map((row) => ({ ...row, progressPercent: Number(row.progressPercent) })),
        consumptions: consumptionRows.map((row) => ({ ...row, quantity: Number(row.quantity) })),
      },
      await loadCompanyBrand(companyIdOf(request)),
    );
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="diario-obra-${entry.date}.pdf"`)
      .send(buffer);
  });

  app.delete("/api/site-diary/:id/photos", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });
    const { url } = request.query as { url?: string };
    if (!url) return reply.code(400).send({ error: "URL da fotografia em falta" });
    const [row] = await db
      .update(siteDiaryEntries)
      .set({ photoUrls: entry.photoUrls.filter((u) => u !== url) })
      .where(eq(siteDiaryEntries.id, id))
      .returning();
    return row;
  });
}
