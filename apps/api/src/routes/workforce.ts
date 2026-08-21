import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { projectSubcontractors, workforceCrews, workforceTimesheets, workforceWorkers } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { resolveCompanyFiscalRate } from "../services/fiscalRateResolver.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;

export async function workforceRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/workforce/inss-rates", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const onDate = (request.query as { onDate?: string }).onDate;
    const [employer, worker] = await Promise.all([
      resolveCompanyFiscalRate(companyId, "inss_employer", onDate),
      resolveCompanyFiscalRate(companyId, "inss_worker", onDate),
    ]);
    return { onDate: onDate ?? null, inssEmployer: employer, inssWorker: worker };
  });

  app.get("/api/projects/:projectId/workforce/workers", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select().from(workforceWorkers).where(and(eq(workforceWorkers.companyId, companyId), eq(workforceWorkers.projectId, projectId))).orderBy(workforceWorkers.name);
    return { workers: rows };
  });

  app.post("/api/projects/:projectId/workforce/workers", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({
      kind: z.enum(["employee", "casual", "subcontract_worker"]).default("employee"),
      name: z.string().trim().min(1).max(200),
      trade: z.string().max(100).optional(),
      reference: z.string().max(80).optional(),
      contact: z.string().max(120).optional(),
      hourlyCost: z.number().min(0).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(workforceWorkers).values({
      companyId,
      projectId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      trade: parsed.data.trade,
      reference: parsed.data.reference,
      contact: parsed.data.contact,
      hourlyCost: parsed.data.hourlyCost?.toFixed(4),
    }).returning();
    return reply.code(201).send(row);
  });

  app.get("/api/projects/:projectId/workforce/crews", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select().from(workforceCrews).where(eq(workforceCrews.projectId, projectId)).orderBy(workforceCrews.name);
    return { crews: rows };
  });

  app.post("/api/projects/:projectId/workforce/crews", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({ name: z.string().trim().min(1).max(200), trade: z.string().max(100).optional(), defaultProductivityNotes: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(workforceCrews).values({ companyId, projectId, name: parsed.data.name, trade: parsed.data.trade, defaultProductivityNotes: parsed.data.defaultProductivityNotes, foremanUserId: request.currentUser!.id }).returning();
    return reply.code(201).send(row);
  });

  app.get("/api/projects/:projectId/workforce/timesheets", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select().from(workforceTimesheets).where(eq(workforceTimesheets.projectId, projectId)).orderBy(desc(workforceTimesheets.workDate));
    return { timesheets: rows };
  });

  app.post("/api/projects/:projectId/workforce/timesheets", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({
      workerId: z.string().uuid().optional(),
      crewId: z.string().uuid().optional(),
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hours: z.number().min(0).max(24).default(8),
      overtimeHours: z.number().min(0).max(12).default(0),
      notes: z.string().max(1000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(workforceTimesheets).values({
      projectId,
      companyId,
      workerId: parsed.data.workerId,
      crewId: parsed.data.crewId,
      workDate: parsed.data.workDate,
      hours: parsed.data.hours.toFixed(2),
      overtimeHours: parsed.data.overtimeHours.toFixed(2),
      notes: parsed.data.notes,
      createdByUserId: request.currentUser!.id,
    }).returning();
    return reply.code(201).send(row);
  });

  app.get("/api/projects/:projectId/subcontractors", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select().from(projectSubcontractors).where(and(eq(projectSubcontractors.projectId, projectId), eq(projectSubcontractors.isActive, true))).orderBy(projectSubcontractors.name);
    return { subcontractors: rows };
  });

  app.post("/api/projects/:projectId/subcontractors", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({
      name: z.string().trim().min(1).max(200),
      nuit: z.string().trim().max(50).optional(),
      contractRef: z.string().max(120).optional(),
      scope: z.string().max(5000).optional(),
      contractValue: z.number().min(0).optional(),
      retentionRate: z.number().min(0).max(1).default(0),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(projectSubcontractors).values({
      companyId,
      projectId,
      name: parsed.data.name,
      nuit: parsed.data.nuit,
      contractRef: parsed.data.contractRef,
      scope: parsed.data.scope,
      contractValue: parsed.data.contractValue?.toFixed(2),
      retentionRate: parsed.data.retentionRate.toString(),
    }).returning();
    await recordAuditEvent({ companyId, projectId, actorUserId: request.currentUser!.id, entityType: "subcontractor", entityId: row.id, action: "created", after: { name: row.name, nuit: row.nuit } });
    return reply.code(201).send(row);
  });
}
