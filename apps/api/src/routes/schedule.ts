import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { scheduleTasks } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertDocumentOwned, assertProjectOwned } from "../services/accessControl.js";
import { addWorkingDays, generateSchedule, getProjectSchedule, getTaskDependency, upsertTaskDependency, validateTaskDependency, workingDaysInclusive } from "../services/scheduleEngine.js";
import { buildSchedulePdf } from "../services/schedulePdf.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;
const taskInput = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(240),
  budgetDocumentId: z.string().uuid().nullable().optional(),
  budgetChapterCode: z.string().max(30).nullable().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  manualProgress: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(["nao_iniciado", "em_curso", "bloqueado", "concluido"]).default("nao_iniciado"),
  notes: z.string().nullable().optional(),
  predecessorTaskId: z.string().uuid().nullable().optional(),
  dependencyType: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
  lagDays: z.number().int().min(-365).max(365).default(0),
});

function companyIdOf(request: FastifyRequest) {
  return request.currentUser!.companyId!;
}

async function ownedTask(id: string, companyId: string) {
  const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, id)).limit(1);
  if (!task || !(await assertProjectOwned(task.projectId, companyId))) return null;
  return task;
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/schedule", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    return getProjectSchedule(projectId);
  });

  app.post("/api/projects/:projectId/schedule/generate", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({ budgetDocumentId: z.string().uuid(), startDate: z.string(), totalDurationDays: z.number().int().min(7).max(3650) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const document = await assertDocumentOwned(parsed.data.budgetDocumentId, companyId);
    if (!document || document.projectId !== projectId) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    try {
      return await generateSchedule({ projectId, ...parsed.data });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível gerar o cronograma" });
    }
  });

  app.post("/api/projects/:projectId/schedule/tasks", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = taskInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.budgetDocumentId) {
      const document = await assertDocumentOwned(parsed.data.budgetDocumentId, companyId);
      if (!document || document.projectId !== projectId) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    }
    if (parsed.data.predecessorTaskId) {
      const predecessor = await ownedTask(parsed.data.predecessorTaskId, companyId);
      if (!predecessor || predecessor.projectId !== projectId) return reply.code(400).send({ error: "A predecessora não pertence ao cronograma desta obra" });
    }
    const [{ value: taskCount }] = await db.select({ value: count() }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId));
    const durationDays = parsed.data.durationDays ?? (parsed.data.endDate ? workingDaysInclusive(parsed.data.startDate, parsed.data.endDate) : 1);
    const endDate = parsed.data.endDate ?? addWorkingDays(parsed.data.startDate, durationDays - 1);
    const { predecessorTaskId, dependencyType, lagDays, manualProgress, ...values } = parsed.data;
    const [task] = await db.insert(scheduleTasks).values({
      ...values,
      projectId,
      endDate,
      durationDays,
      manualProgress: manualProgress === null || manualProgress === undefined ? null : manualProgress.toString(),
      sortOrder: taskCount,
    }).returning();
    await upsertTaskDependency(task.id, predecessorTaskId, dependencyType, lagDays);
    return reply.code(201).send(task);
  });

  app.put("/api/schedule/tasks/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await ownedTask(id, companyIdOf(request));
    if (!current) return reply.code(404).send({ error: "Tarefa não encontrada" });
    const parsed = taskInput.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const dependencyTouched = parsed.data.predecessorTaskId !== undefined || parsed.data.dependencyType !== undefined || parsed.data.lagDays !== undefined;
    const currentDependency = dependencyTouched ? await getTaskDependency(id) : null;
    const nextDependency = dependencyTouched ? {
      predecessorTaskId: parsed.data.predecessorTaskId !== undefined ? parsed.data.predecessorTaskId : currentDependency?.predecessorTaskId ?? null,
      type: parsed.data.dependencyType ?? currentDependency?.type ?? "FS",
      lagDays: parsed.data.lagDays ?? currentDependency?.lagDays ?? 0,
    } : null;
    try {
      if (nextDependency) await validateTaskDependency(current.projectId, id, nextDependency.predecessorTaskId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Dependência inválida" });
    }
    const startDate = parsed.data.startDate ?? current.startDate;
    let endDate = parsed.data.endDate ?? current.endDate;
    let durationDays = parsed.data.durationDays ?? current.durationDays;
    if (parsed.data.durationDays !== undefined && parsed.data.endDate === undefined) endDate = addWorkingDays(startDate, durationDays - 1);
    if (parsed.data.endDate !== undefined && parsed.data.durationDays === undefined) durationDays = workingDaysInclusive(startDate, endDate);
    if (endDate < startDate) return reply.code(400).send({ error: "A data final não pode ser anterior ao início" });
    const { predecessorTaskId, dependencyType, lagDays, manualProgress, ...values } = parsed.data;
    const today = new Date().toISOString().slice(0, 10);
    const statusDates = parsed.data.status === "em_curso" && !current.actualStartDate
      ? { actualStartDate: today }
      : parsed.data.status === "concluido"
        ? { actualStartDate: current.actualStartDate ?? today, actualEndDate: today }
        : {};
    const [task] = await db.update(scheduleTasks).set({
      ...values,
      startDate,
      endDate,
      durationDays,
      manualProgress: manualProgress === undefined ? undefined : manualProgress === null ? null : manualProgress.toString(),
      ...statusDates,
      updatedAt: new Date(),
    }).where(eq(scheduleTasks.id, id)).returning();
    if (nextDependency) {
      await upsertTaskDependency(id, nextDependency.predecessorTaskId, nextDependency.type, nextDependency.lagDays);
    }
    return task;
  });

  app.delete("/api/schedule/tasks/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedTask(id, companyIdOf(request)))) return { ok: true };
    await db.delete(scheduleTasks).where(eq(scheduleTasks.id, id));
    return { ok: true };
  });

  app.get("/api/projects/:projectId/schedule/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const schedule = await getProjectSchedule(projectId);
    if (!schedule.tasks.length) return reply.code(409).send({ error: "O cronograma ainda não tem tarefas" });
    const buffer = await buildSchedulePdf(project, schedule);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="Cronograma-${project.name.replace(/[^\p{L}\p{N}\- ]/gu, "")}-A3.pdf"`).send(buffer);
  });
}
