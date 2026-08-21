import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { mzHolidays, projectScheduleCalendars, scheduleTasks } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertDocumentOwned, assertProjectOwned } from "../services/accessControl.js";
import { assertApprovedOrcamentoForSite } from "../services/siteGate.js";
import { loadProjectWorkCalendar } from "../services/workCalendar.js";
import {
  addWorkingDays,
  cascadeSuccessorDates,
  computeSuccessorDates,
  generateSchedule,
  getProjectSchedule,
  getSchedulePlanningSetup,
  getTaskDependency,
  isWorkingDay,
  previewSchedulePlanning,
  saveSchedulePlanningProfile,
  upsertTaskDependency,
  validateTaskDependency,
  workingDaysInclusive,
} from "../services/scheduleEngine.js";
import { buildSchedulePdf } from "../services/schedulePdf.js";
import { loadCompanyBrand, logoDataUri } from "../services/companyBrand.js";
import { brandDisplayName, brandFooterText } from "../services/documentChrome.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;
const scheduleExportQuery = z.object({
  paper: z.enum(["auto", "A3", "A2", "A1"]).default("auto"),
  scale: z.preprocess(
    (value) => value === undefined || value === "fit" ? "fit" : Number(value),
    z.union([z.literal("fit"), z.number().min(20).max(100)]),
  ),
});
const taskInput = z.object({
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(240),
  budgetDocumentId: z.string().uuid().nullable().optional(),
  budgetChapterCode: z.string().max(30).nullable().optional(),
  startDate: z.string().refine(isWorkingDay, { message: "A obra não trabalha ao domingo — escolha uma data de segunda a sábado" }),
  endDate: z.string().optional(),
  durationDays: z.number().int().nonnegative().optional(),
  manualProgress: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(["nao_iniciado", "em_curso", "bloqueado", "concluido"]).default("nao_iniciado"),
  notes: z.string().nullable().optional(),
  predecessorTaskId: z.string().uuid().nullable().optional(),
  dependencyType: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
  lagDays: z.number().int().min(-365).max(365).default(0),
});

const tradeFrontsSchema = z.object({
  earthworks: z.number().int().min(1).max(20).nullable(),
  structure: z.number().int().min(1).max(20).nullable(),
  masonry: z.number().int().min(1).max(20).nullable(),
  mep: z.number().int().min(1).max(20).nullable(),
  finishes: z.number().int().min(1).max(20).nullable(),
  roofing: z.number().int().min(1).max(20).nullable(),
  external: z.number().int().min(1).max(20).nullable(),
});
const crewSizesSchema = z.object({
  earthworks: z.number().int().min(1).max(60).nullable(),
  structure: z.number().int().min(1).max(60).nullable(),
  masonry: z.number().int().min(1).max(60).nullable(),
  mep: z.number().int().min(1).max(60).nullable(),
  finishes: z.number().int().min(1).max(60).nullable(),
  roofing: z.number().int().min(1).max(60).nullable(),
  external: z.number().int().min(1).max(60).nullable(),
});
const planningProfileSchema = z.object({
  schemaVersion: z.literal(1),
  startDate: z.string().refine(isWorkingDay, { message: "A obra não trabalha ao domingo — escolha uma data de segunda a sábado" }),
  locationStrategy: z.enum(["boq", "floors", "floors_zones"]),
  floorLabels: z.array(z.string().min(1).max(100)).min(1).max(20),
  floorShares: z.array(z.number().min(0).max(1)).min(1).max(20).nullable(),
  zones: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    share: z.number().min(0).max(1).nullable(),
  })).max(20),
  sequencePolicy: z.enum(["floor_by_floor", "structure_complete_first"]),
  tradeFronts: tradeFrontsSchema,
  crewSizes: crewSizesSchema,
  cureLags: z.object({
    foundations: z.number().int().min(0).max(60).nullable(),
    columns: z.number().int().min(0).max(60).nullable(),
    slabs: z.number().int().min(0).max(60).nullable(),
  }),
  roofKindOverride: z.enum(["sheet", "slab"]).nullable(),
  targetDurationDays: z.number().int().min(7).max(3650).nullable(),
  notes: z.string().max(4000).nullable(),
  planningAllowances: z.array(z.object({
    kind: z.enum(["rain", "cyclone_wind", "heat", "accessibility"]),
    month: z.number().int().min(1).max(12),
    regionCode: z.string().max(8).nullable(),
    enabled: z.boolean(),
    note: z.string().max(500).nullable(),
  })).max(48).optional().default([]),
});
const planningSetupInput = z.object({
  budgetDocumentId: z.string().uuid(),
  startDate: z.string().refine(isWorkingDay, { message: "A obra não trabalha ao domingo — escolha uma data de segunda a sábado" }),
});
const planningProfileInput = z.object({
  budgetDocumentId: z.string().uuid(),
  profile: planningProfileSchema,
});
const generateInput = planningSetupInput.extend({
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

function companyIdOf(request: FastifyRequest) {
  return request.currentUser!.companyId!;
}

async function ownedTask(id: string, companyId: string) {
  const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, id)).limit(1);
  if (!task || !(await assertProjectOwned(task.projectId, companyId))) return null;
  return task;
}

const MAX_WBS_DEPTH = 4; // raiz = 0; permite até 4 níveis (ex.: capítulo → piso → pacote → subtarefa)

async function taskDepth(taskId: string): Promise<number> {
  let depth = 0;
  let cursorId: string | null = taskId;
  const seen = new Set<string>();
  while (cursorId) {
    if (seen.has(cursorId)) break;
    seen.add(cursorId);
    const [row] = await db.select({ parentId: scheduleTasks.parentId }).from(scheduleTasks).where(eq(scheduleTasks.id, cursorId)).limit(1);
    if (!row?.parentId) break;
    depth += 1;
    cursorId = row.parentId;
    if (depth > MAX_WBS_DEPTH) break;
  }
  return depth;
}

async function validateParentTask(parentId: string | null | undefined, projectId: string, companyId: string, taskId?: string) {
  if (!parentId) return null;
  if (parentId === taskId) throw new Error("Uma actividade não pode ser subactividade de si própria");
  const parent = await ownedTask(parentId, companyId);
  if (!parent || parent.projectId !== projectId) throw new Error("A actividade principal não pertence a este cronograma");
  const parentDepth = await taskDepth(parent.id);
  if (parentDepth >= MAX_WBS_DEPTH - 1) {
    throw new Error(`A WBS permite no máximo ${MAX_WBS_DEPTH} níveis de detalhe`);
  }
  if (taskId) {
    // Impede ciclos: o novo pai não pode ser descendente da própria tarefa.
    let cursorId: string | null = parentId;
    const seen = new Set<string>();
    while (cursorId) {
      if (cursorId === taskId) throw new Error("Não pode tornar uma actividade subactividade de uma das suas próprias filhas");
      if (seen.has(cursorId)) break;
      seen.add(cursorId);
      const [row] = await db.select({ parentId: scheduleTasks.parentId }).from(scheduleTasks).where(eq(scheduleTasks.id, cursorId)).limit(1);
      cursorId = row?.parentId ?? null;
    }
  }
  return parent;
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.get("/api/mz/holidays", { preHandler: requireCompanyUser }, async (request) => {
    const year = Number((request.query as { year?: string }).year) || new Date().getFullYear();
    return db.select().from(mzHolidays).where(eq(mzHolidays.year, year)).orderBy(mzHolidays.date);
  });

  app.get("/api/projects/:projectId/schedule/calendar", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    return loadProjectWorkCalendar(projectId);
  });

  app.put("/api/projects/:projectId/schedule/calendar", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({
      saturdayWorking: z.boolean(),
      hoursPerDay: z.number().min(1).max(24).optional().nullable(),
      useNationalHolidays: z.boolean(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await db.insert(projectScheduleCalendars).values({
      projectId,
      saturdayWorking: parsed.data.saturdayWorking,
      hoursPerDay: parsed.data.hoursPerDay != null ? String(parsed.data.hoursPerDay) : null,
      useNationalHolidays: parsed.data.useNationalHolidays,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: projectScheduleCalendars.projectId,
      set: {
        saturdayWorking: parsed.data.saturdayWorking,
        hoursPerDay: parsed.data.hoursPerDay != null ? String(parsed.data.hoursPerDay) : null,
        useNationalHolidays: parsed.data.useNationalHolidays,
        updatedAt: new Date(),
      },
    });
    return loadProjectWorkCalendar(projectId);
  });

  app.get("/api/projects/:projectId/schedule", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    return getProjectSchedule(projectId);
  });

  async function planningGate(projectId: string, budgetDocumentId: string, companyId: string) {
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const document = await assertDocumentOwned(budgetDocumentId, companyId);
    if (!document || document.projectId !== projectId) return { ok: false as const, status: 404, error: "Mapa de Quantidades não encontrado" };
    if (document.documentType !== "orcamento" || document.status !== "aprovado") {
      return { ok: false as const, status: 409, error: "Seleccione um orçamento aprovado para planear a EAP" };
    }
    return { ok: true as const, gate };
  }

  app.post("/api/projects/:projectId/schedule/planning/setup", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const parsed = planningSetupInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const access = await planningGate(projectId, parsed.data.budgetDocumentId, companyId);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });
    try {
      return await getSchedulePlanningSetup({ projectId, ...parsed.data, companyId, zoneId: access.gate.project.zoneId ?? null });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível preparar o Assistente de Planeamento" });
    }
  });

  app.put("/api/projects/:projectId/schedule/planning/profile", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const parsed = planningProfileInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const access = await planningGate(projectId, parsed.data.budgetDocumentId, companyId);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });
    try {
      const profile = await saveSchedulePlanningProfile({ projectId, ...parsed.data, companyId, zoneId: access.gate.project.zoneId ?? null });
      return { profile, status: "draft" };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Perfil de planeamento inválido" });
    }
  });

  app.post("/api/projects/:projectId/schedule/planning/preview", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const parsed = planningSetupInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const access = await planningGate(projectId, parsed.data.budgetDocumentId, companyId);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });
    try {
      return await previewSchedulePlanning({ projectId, ...parsed.data, companyId, zoneId: access.gate.project.zoneId ?? null });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível pré-visualizar a estratégia" });
    }
  });

  app.post("/api/projects/:projectId/schedule/generate", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const parsed = generateInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const document = await assertDocumentOwned(parsed.data.budgetDocumentId, companyId);
    if (!document || document.projectId !== projectId) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    if (document.documentType !== "orcamento" || document.status !== "aprovado") {
      return reply.code(409).send({ error: "Seleccione um orçamento aprovado para gerar o cronograma" });
    }
    try {
      return await generateSchedule({ projectId, ...parsed.data, companyId, zoneId: gate.project.zoneId ?? null });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível gerar o cronograma" });
    }
  });


  app.post("/api/projects/:projectId/schedule/tasks", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const parsed = taskInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.budgetDocumentId) {
      const document = await assertDocumentOwned(parsed.data.budgetDocumentId, companyId);
      if (!document || document.projectId !== projectId) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    }
    let predecessorTask: typeof scheduleTasks.$inferSelect | null = null;
    if (parsed.data.predecessorTaskId) {
      predecessorTask = await ownedTask(parsed.data.predecessorTaskId, companyId);
      if (!predecessorTask || predecessorTask.projectId !== projectId) return reply.code(400).send({ error: "A predecessora não pertence ao cronograma desta obra" });
    }
    try {
      await validateParentTask(parsed.data.parentId, projectId, companyId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Actividade principal inválida" });
    }
    const [{ value: taskCount }] = await db.select({ value: count() }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId));
    const durationDays = parsed.data.durationDays ?? (parsed.data.endDate ? workingDaysInclusive(parsed.data.startDate, parsed.data.endDate) : 1);
    // Com predecessora definida, as datas são sempre calculadas a partir dela (FS/SS/FF/SF +
    // folga) — nunca da data escrita manualmente, para nunca ficarem inconsistentes.
    // Marco (duração 0): fim == início, nunca um dia útil ANTES do início.
    const { startDate, endDate } = predecessorTask
      ? computeSuccessorDates(predecessorTask, parsed.data.dependencyType, parsed.data.lagDays, durationDays)
      : { startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? (durationDays > 0 ? addWorkingDays(parsed.data.startDate, durationDays - 1) : parsed.data.startDate) };
    if (endDate < startDate) return reply.code(400).send({ error: "A data final não pode ser anterior ao início" });
    const { predecessorTaskId, dependencyType, lagDays, manualProgress, startDate: _startDate, endDate: _endDate, ...values } = parsed.data;
    const [task] = await db.insert(scheduleTasks).values({
      ...values,
      projectId,
      startDate,
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
    const companyId = companyIdOf(request);
    const current = await ownedTask(id, companyId);
    if (!current) return reply.code(404).send({ error: "Tarefa não encontrada" });
    const gate = await assertApprovedOrcamentoForSite(current.projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const parsed = taskInput.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      if (parsed.data.parentId !== undefined) await validateParentTask(parsed.data.parentId, current.projectId, companyIdOf(request), id);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Actividade principal inválida" });
    }
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
    let startDate = parsed.data.startDate ?? current.startDate;
    let endDate = parsed.data.endDate ?? current.endDate;
    let durationDays = parsed.data.durationDays ?? current.durationDays;
    if (parsed.data.durationDays !== undefined && parsed.data.endDate === undefined) endDate = durationDays > 0 ? addWorkingDays(startDate, durationDays - 1) : startDate;
    if (parsed.data.endDate !== undefined && parsed.data.durationDays === undefined) durationDays = workingDaysInclusive(startDate, endDate);
    // Com predecessora definida, as datas nunca vêm do que foi escrito à mão — são sempre
    // recalculadas a partir dela (FS/SS/FF/SF + folga), tal como na criação da tarefa.
    if (nextDependency?.predecessorTaskId) {
      const predecessorTask = await ownedTask(nextDependency.predecessorTaskId, companyId);
      if (predecessorTask) {
        const computed = computeSuccessorDates(predecessorTask, nextDependency.type, nextDependency.lagDays, durationDays);
        startDate = computed.startDate;
        endDate = computed.endDate;
      }
    }
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
    // As datas desta tarefa podem ter mudado (edição directa ou herdadas da predecessora) —
    // propaga a quem depende dela, para nunca ficarem "penduradas" nas datas antigas.
    if (task.startDate !== current.startDate || task.endDate !== current.endDate) {
      await cascadeSuccessorDates(id);
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
    const parsed = scheduleExportQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Formato ou escala de impressão inválidos" });
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const schedule = await getProjectSchedule(projectId);
    if (!schedule.tasks.length) return reply.code(409).send({ error: "O cronograma ainda não tem tarefas" });
    const companyBrand = await loadCompanyBrand(companyIdOf(request));
    const { buffer, options } = await buildSchedulePdf(project, schedule, parsed.data, {
      displayName: brandDisplayName(companyBrand),
      logoDataUri: logoDataUri(companyBrand.logoUrl),
      primaryColor: companyBrand.primaryColor,
      footer: brandFooterText(companyBrand, "Cronograma"),
    });
    return reply
      .header("Content-Type", "application/pdf")
      .header("X-SIGO-Schedule-Paper", options.paper)
      .header("X-SIGO-Schedule-Scale", String(options.scalePercent))
      .header("Content-Disposition", `attachment; filename="Cronograma-${project.name.replace(/[^\p{L}\p{N}\- ]/gu, "")}-${options.paper}-${options.scalePercent}pct.pdf"`)
      .send(buffer);
  });
}
