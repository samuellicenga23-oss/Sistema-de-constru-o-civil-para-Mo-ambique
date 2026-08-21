import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { hstRecords, qualityInspections, scheduleTasks, siteDiaryEntries } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { ensureInspectionTemplates } from "../services/inspectionTemplates.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;
const TRADES = ["cofragem", "armadura", "betão", "alvenaria", "impermeabilizacao", "instalacoes", "acabamentos"] as const;
const INSPECTION_STATUSES = ["rascunho", "pass", "fail", "pendente"] as const;
const HST_TYPES = ["toolbox_talk", "incidente", "observacao_risco", "ppe_check"] as const;

const inspectionSchema = z.object({
  trade: z.enum(TRADES),
  templateId: z.string().uuid().optional(),
  location: z.string().max(200).optional(),
  scheduleTaskId: z.string().uuid().optional(),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(INSPECTION_STATUSES).default("rascunho"),
  checklistResults: z.array(z.object({ key: z.string(), pass: z.boolean(), notes: z.string().optional() })).optional(),
  photoRefs: z.array(z.string()).optional(),
  notes: z.string().max(5000).optional(),
  diaryEntryId: z.string().uuid().optional(),
  offlineSyncKey: z.string().max(100).optional(),
});

const hstSchema = z.object({
  recordType: z.enum(HST_TYPES),
  recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().max(200).optional(),
  description: z.string().trim().min(1).max(5000),
  photoRefs: z.array(z.string()).optional(),
  diaryEntryId: z.string().uuid().optional(),
  offlineSyncKey: z.string().max(100).optional(),
});

async function assertDiaryInProject(diaryEntryId: string | undefined, projectId: string) {
  if (!diaryEntryId) return true;
  const [entry] = await db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.id, diaryEntryId)).limit(1);
  return entry?.projectId === projectId;
}

async function assertTaskInProject(taskId: string | undefined, projectId: string) {
  if (!taskId) return true;
  const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, taskId)).limit(1);
  return task?.projectId === projectId;
}

export async function fieldQualityRoutes(app: FastifyInstance) {
  app.get("/api/inspection-templates", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const templates = await ensureInspectionTemplates(companyId);
    return { templates };
  });

  app.get("/api/projects/:projectId/quality-inspections", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, request.currentUser!.companyId!))) {
      return reply.code(404).send({ error: "Projecto não encontrado" });
    }
    const rows = await db
      .select()
      .from(qualityInspections)
      .where(eq(qualityInspections.projectId, projectId))
      .orderBy(desc(qualityInspections.inspectionDate), desc(qualityInspections.createdAt));
    return { inspections: rows };
  });

  app.post("/api/projects/:projectId/quality-inspections", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = inspectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await assertDiaryInProject(parsed.data.diaryEntryId, projectId))) {
      return reply.code(400).send({ error: "Entrada de diário inválida para este projecto" });
    }
    if (!(await assertTaskInProject(parsed.data.scheduleTaskId, projectId))) {
      return reply.code(400).send({ error: "Actividade inválida para este projecto" });
    }
    if (parsed.data.offlineSyncKey) {
      const [existing] = await db
        .select()
        .from(qualityInspections)
        .where(and(eq(qualityInspections.projectId, projectId), eq(qualityInspections.offlineSyncKey, parsed.data.offlineSyncKey)))
        .limit(1);
      if (existing) return existing;
    }
    const [row] = await db
      .insert(qualityInspections)
      .values({
        projectId,
        companyId,
        templateId: parsed.data.templateId,
        trade: parsed.data.trade,
        location: parsed.data.location,
        scheduleTaskId: parsed.data.scheduleTaskId,
        inspectorUserId: request.currentUser!.id,
        inspectionDate: parsed.data.inspectionDate,
        status: parsed.data.status,
        checklistResults: parsed.data.checklistResults ?? [],
        photoRefs: parsed.data.photoRefs ?? [],
        notes: parsed.data.notes,
        diaryEntryId: parsed.data.diaryEntryId,
        offlineSyncKey: parsed.data.offlineSyncKey,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    await recordAuditEvent({
      companyId,
      projectId,
      actorUserId: request.currentUser!.id,
      entityType: "quality_inspection",
      entityId: row.id,
      action: "created",
      after: { trade: row.trade, status: row.status, inspectionDate: row.inspectionDate },
    });
    return reply.code(201).send(row);
  });

  app.put("/api/quality-inspections/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [existing] = await db.select().from(qualityInspections).where(eq(qualityInspections.id, id)).limit(1);
    if (!existing || existing.companyId !== request.currentUser!.companyId!) {
      return reply.code(404).send({ error: "Inspecção não encontrada" });
    }
    const parsed = inspectionSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.diaryEntryId && !(await assertDiaryInProject(parsed.data.diaryEntryId, existing.projectId))) {
      return reply.code(400).send({ error: "Entrada de diário inválida" });
    }
    const [row] = await db
      .update(qualityInspections)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(qualityInspections.id, id))
      .returning();
    await recordAuditEvent({
      companyId: existing.companyId,
      projectId: existing.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "quality_inspection",
      entityId: id,
      action: "updated",
      before: { status: existing.status },
      after: { status: row.status },
    });
    return row;
  });

  app.get("/api/projects/:projectId/hst-records", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, request.currentUser!.companyId!))) {
      return reply.code(404).send({ error: "Projecto não encontrado" });
    }
    const rows = await db
      .select()
      .from(hstRecords)
      .where(eq(hstRecords.projectId, projectId))
      .orderBy(desc(hstRecords.recordDate), desc(hstRecords.createdAt));
    return { records: rows };
  });

  app.post("/api/projects/:projectId/hst-records", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = hstSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await assertDiaryInProject(parsed.data.diaryEntryId, projectId))) {
      return reply.code(400).send({ error: "Entrada de diário inválida para este projecto" });
    }
    if (parsed.data.offlineSyncKey) {
      const [existing] = await db
        .select()
        .from(hstRecords)
        .where(and(eq(hstRecords.projectId, projectId), eq(hstRecords.offlineSyncKey, parsed.data.offlineSyncKey)))
        .limit(1);
      if (existing) return existing;
    }
    const [row] = await db
      .insert(hstRecords)
      .values({
        projectId,
        companyId,
        recordType: parsed.data.recordType,
        recordDate: parsed.data.recordDate,
        location: parsed.data.location,
        description: parsed.data.description,
        photoRefs: parsed.data.photoRefs ?? [],
        diaryEntryId: parsed.data.diaryEntryId,
        offlineSyncKey: parsed.data.offlineSyncKey,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    await recordAuditEvent({
      companyId,
      projectId,
      actorUserId: request.currentUser!.id,
      entityType: "hst_record",
      entityId: row.id,
      action: "created",
      after: { recordType: row.recordType, recordDate: row.recordDate },
    });
    return reply.code(201).send(row);
  });
}
