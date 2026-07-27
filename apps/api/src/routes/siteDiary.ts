import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { materials, projects, scheduleTasks, siteDiaryEntries, siteDiaryTaskProgress, stockMovements } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { detectImageExtension } from "../services/imageValidation.js";
import { buildSiteDiaryPdf } from "../services/siteDiaryExport.js";
import { env } from "../env.js";

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
const entryUpdateSchema = entrySchema.omit({ taskProgress: true, consumptions: true }).partial();

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
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = entrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { taskProgress = [], consumptions = [], ...entryData } = parsed.data;
    if (taskProgress.length) {
      const tasks = await db.select().from(scheduleTasks).where(inArray(scheduleTasks.id, taskProgress.map((item) => item.taskId)));
      if (tasks.length !== new Set(taskProgress.map((item) => item.taskId)).size || tasks.some((task) => task.projectId !== projectId)) {
        return reply.code(400).send({ error: "Uma das tarefas não pertence ao cronograma desta obra" });
      }
    }
    if (consumptions.length) {
      const companyId = companyIdOf(request);
      const materialIds = Array.from(new Set(consumptions.map((item) => item.materialId)));
      const visibleMaterials = await db.select().from(materials).where(and(inArray(materials.id, materialIds), or(isNull(materials.companyId), eq(materials.companyId, companyId))));
      if (visibleMaterials.length !== materialIds.length) return reply.code(400).send({ error: "Um dos materiais não existe no Catálogo" });
      const movements = await db.select().from(stockMovements).where(and(eq(stockMovements.projectId, projectId), inArray(stockMovements.materialId, materialIds)));
      for (const materialId of materialIds) {
        const available = movements.filter((movement) => movement.materialId === materialId).reduce((sum, movement) => sum + (movement.type === "entrada" ? Number(movement.quantity) : -Number(movement.quantity)), 0);
        const requested = consumptions.filter((item) => item.materialId === materialId).reduce((sum, item) => sum + item.quantity, 0);
        if (requested > available + 0.0001) {
          const material = visibleMaterials.find((item) => item.id === materialId);
          return reply.code(409).send({ error: `Stock insuficiente de ${material?.name ?? "material"}: disponível ${available.toFixed(3)} ${material?.unit ?? ""}` });
        }
      }
    }

    const [row] = await db
      .insert(siteDiaryEntries)
      .values({ ...entryData, projectId, createdByUserId: request.currentUser!.id })
      .returning();
    if (taskProgress.length) await db.insert(siteDiaryTaskProgress).values(taskProgress.map((item) => ({
      diaryEntryId: row.id,
      scheduleTaskId: item.taskId,
      progressPercent: item.progressPercent.toString(),
      notes: item.notes,
    })));
    if (consumptions.length) await db.insert(stockMovements).values(consumptions.map((item) => ({
      projectId,
      materialId: item.materialId,
      type: "saida" as const,
      quantity: item.quantity.toString(),
      notes: item.notes ?? "Consumo registado no Diário de Obra",
      diaryEntryId: row.id,
      createdByUserId: request.currentUser!.id,
      date: entryData.date,
    })));
    return reply.code(201).send(row);
  });

  app.put("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    const parsed = entryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.update(siteDiaryEntries).set(parsed.data).where(eq(siteDiaryEntries.id, id)).returning();
    return row;
  });

  app.delete("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return { ok: true };
    await db.delete(siteDiaryEntries).where(eq(siteDiaryEntries.id, id));
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
    const buffer = await buildSiteDiaryPdf(entry, project, {
      progress: progressRows.map((row) => ({ ...row, progressPercent: Number(row.progressPercent) })),
      consumptions: consumptionRows.map((row) => ({ ...row, quantity: Number(row.quantity) })),
    });
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
    if (!url) return reply.code(400).send({ error: "url em falta" });
    const [row] = await db
      .update(siteDiaryEntries)
      .set({ photoUrls: entry.photoUrls.filter((u) => u !== url) })
      .where(eq(siteDiaryEntries.id, id))
      .returning();
    return row;
  });
}
