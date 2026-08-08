import type { FastifyInstance } from "fastify";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  lineItems,
  measurementCertificateFieldLines,
  measurementCertificateLines,
  measurementCertificates,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertCertificateOwned } from "../services/accessControl.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { calculateMeasurementPartial, MEASUREMENT_FORMULA_TYPES, type MeasurementFormulaType } from "../services/measurementFormulaEngine.js";
import { computeFieldPeriodTotals } from "../services/certificateMeasurementEngine.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;
const inputSchema = z.object({
  description: z.string().max(300).default(""),
  formulaType: z.enum(MEASUREMENT_FORMULA_TYPES),
  sign: z.union([z.literal(1), z.literal(-1)]).default(1),
  count: z.number().positive().nullable().optional(),
  length: z.number().nonnegative().nullable().optional(),
  width: z.number().nonnegative().nullable().optional(),
  height: z.number().nonnegative().nullable().optional(),
  directQuantity: z.number().nonnegative().nullable().optional(),
  coefficient: z.number().nonnegative().default(1),
  unitWeight: z.number().nonnegative().nullable().optional(),
  diameterMm: z.number().positive().nullable().optional(),
  baseQuantity: z.number().nonnegative().nullable().optional(),
  percentage: z.number().nonnegative().nullable().optional(),
  block: z.string().max(100).nullable().optional(), floor: z.string().max(100).nullable().optional(),
  zone: z.string().max(120).nullable().optional(), room: z.string().max(160).nullable().optional(),
  axis: z.string().max(120).nullable().optional(), element: z.string().max(160).nullable().optional(),
  evidenceUrls: z.array(z.string().max(500)).max(20).default([]),
  notes: z.string().max(1000).nullable().optional(),
  overrunReason: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});
type Input = z.infer<typeof inputSchema>;

function partialOf(row: any) {
  return calculateMeasurementPartial({
    formulaType: row.formulaType as MeasurementFormulaType, sign: Number(row.sign), count: Number(row.count),
    length: row.length == null ? null : Number(row.length), width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
    directQuantity: row.directQuantity == null ? null : Number(row.directQuantity), coefficient: Number(row.coefficient ?? 1),
    unitWeight: row.unitWeight == null ? null : Number(row.unitWeight), diameterMm: row.diameterMm == null ? null : Number(row.diameterMm),
    baseQuantity: row.baseQuantity == null ? null : Number(row.baseQuantity), percentage: row.percentage == null ? null : Number(row.percentage),
  }).partial;
}
function values(certificateLineId: string, data: Input, userId: string, extra?: { revisionNo?: number; supersedesLineId?: string | null }) {
  calculateMeasurementPartial(data);
  return {
    certificateLineId, description: data.description, formulaType: data.formulaType, sign: data.sign,
    count: data.count == null ? "1" : data.count.toString(), length: data.length == null ? null : data.length.toString(),
    width: data.width == null ? null : data.width.toString(), height: data.height == null ? null : data.height.toString(),
    directQuantity: data.directQuantity == null ? null : data.directQuantity.toString(), coefficient: data.coefficient.toString(),
    unitWeight: data.unitWeight == null ? null : data.unitWeight.toString(), diameterMm: data.diameterMm == null ? null : data.diameterMm.toString(),
    baseQuantity: data.baseQuantity == null ? null : data.baseQuantity.toString(), percentage: data.percentage == null ? null : data.percentage.toString(),
    block: data.block ?? null, floor: data.floor ?? null, zone: data.zone ?? null, room: data.room ?? null, axis: data.axis ?? null, element: data.element ?? null,
    evidenceUrls: data.evidenceUrls, notes: data.notes ?? null, sortOrder: data.sortOrder,
    revisionNo: extra?.revisionNo ?? 1, supersedesLineId: extra?.supersedesLineId ?? null, isActive: true,
    createdByUserId: userId, updatedAt: new Date(),
  };
}
async function ownedContext(certificateLineId: string, companyId: string) {
  const [row] = await db.select({ line: measurementCertificateLines, certificate: measurementCertificates })
    .from(measurementCertificateLines).innerJoin(measurementCertificates, eq(measurementCertificateLines.certificateId, measurementCertificates.id))
    .where(eq(measurementCertificateLines.id, certificateLineId)).limit(1);
  if (!row || !(await assertCertificateOwned(row.certificate.id, companyId))) return null;
  return row;
}
async function recompute(tx: any, certificateLineId: string, overrunReason?: string | null) {
  await tx.execute(sql`select id from measurement_certificate_lines where id=${certificateLineId} for update`);
  const [context] = await tx.select({ line: measurementCertificateLines, certificate: measurementCertificates, budgetedQty: lineItems.quantity })
    .from(measurementCertificateLines)
    .innerJoin(measurementCertificates, eq(measurementCertificateLines.certificateId, measurementCertificates.id))
    .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
    .where(eq(measurementCertificateLines.id, certificateLineId)).limit(1);
  if (!context) throw new Error("Linha do Auto não encontrada");
  if (context.certificate.status !== "rascunho") throw new Error("A memória de campo só pode ser editada no Auto em rascunho");
  const active = await tx.select().from(measurementCertificateFieldLines).where(and(eq(measurementCertificateFieldLines.certificateLineId, certificateLineId), eq(measurementCertificateFieldLines.isActive, true)));

  const [previousCertificate] = await tx.select().from(measurementCertificates)
    .where(and(eq(measurementCertificates.budgetDocumentId, context.certificate.budgetDocumentId), lt(measurementCertificates.number, context.certificate.number), eq(measurementCertificates.status, "aprovado")))
    .orderBy(desc(measurementCertificates.number)).limit(1);
  let previousQty = 0;
  if (previousCertificate) {
    const [previousLine] = await tx.select().from(measurementCertificateLines)
      .where(and(eq(measurementCertificateLines.certificateId, previousCertificate.id), eq(measurementCertificateLines.lineItemId, context.line.lineItemId))).limit(1);
    previousQty = Number(previousLine?.cumulativeQty ?? 0);
  }
  const budgetedQty = context.budgetedQty == null ? null : Number(context.budgetedQty);
  const reason = overrunReason?.trim() || context.line.overrunReason?.trim() || null;
  const totals = computeFieldPeriodTotals({
    previousQty,
    partials: active.map((row: any) => ({ partial: partialOf(row) })),
    budgetedQty,
    overrunReason: reason,
  });
  const [updated] = await tx.update(measurementCertificateLines).set({
    periodQty: totals.periodQty.toFixed(4), cumulativeQty: totals.cumulativeQty.toFixed(4), overrunReason: reason,
  }).where(eq(measurementCertificateLines.id, certificateLineId)).returning();
  return { line: updated, periodQty: totals.periodQty, cumulativeQty: totals.cumulativeQty, excess: totals.excessQty };
}

export async function certificateFieldMeasurementRoutes(app: FastifyInstance) {
  app.get("/api/measurement-certificate-lines/:id/field-measurements", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string }; const companyId = request.currentUser!.companyId!;
    if (!(await ownedContext(id, companyId))) return reply.code(404).send({ error: "Linha do Auto não encontrada" });
    const { history } = request.query as { history?: string };
    const condition = history === "true" ? eq(measurementCertificateFieldLines.certificateLineId, id) : and(eq(measurementCertificateFieldLines.certificateLineId, id), eq(measurementCertificateFieldLines.isActive, true));
    const rows = await db.select().from(measurementCertificateFieldLines).where(condition).orderBy(measurementCertificateFieldLines.sortOrder, measurementCertificateFieldLines.revisionNo, measurementCertificateFieldLines.createdAt);
    return rows.map((row) => ({ ...row, partial: partialOf(row) }));
  });

  app.post("/api/measurement-certificate-lines/:id/field-measurements", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string }; const companyId = request.currentUser!.companyId!;
    const context = await ownedContext(id, companyId); if (!context) return reply.code(404).send({ error: "Linha do Auto não encontrada" });
    if (context.certificate.status !== "rascunho") return reply.code(409).send({ error: "O Auto está bloqueado" });
    const parsed = inputSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await db.transaction(async (tx) => {
        const [created] = await tx.insert(measurementCertificateFieldLines).values(values(id, parsed.data, request.currentUser!.id)).returning();
        const totals = await recompute(tx, id, parsed.data.overrunReason); return { created, totals };
      });
      await recordAuditEvent({ companyId, projectId: context.certificate.projectId, actorUserId: request.currentUser!.id, entityType: "measurement_certificate_field_line", entityId: result.created.id, action: "created", after: { certificateLineId: id, partial: partialOf(result.created), periodQty: result.totals.periodQty } });
      return reply.code(201).send({ ...result.created, partial: partialOf(result.created), ...result.totals });
    } catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível registar a medição de campo" }); }
  });

  app.put("/api/measurement-certificate-field-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string }; const companyId = request.currentUser!.companyId!;
    const [existing] = await db.select().from(measurementCertificateFieldLines).where(and(eq(measurementCertificateFieldLines.id, id), eq(measurementCertificateFieldLines.isActive, true))).limit(1);
    const context = existing ? await ownedContext(existing.certificateLineId, companyId) : null;
    if (!existing || !context) return reply.code(404).send({ error: "Medição de campo não encontrada" });
    const parsed = inputSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await db.transaction(async (tx) => {
        await tx.update(measurementCertificateFieldLines).set({ isActive: false, updatedAt: new Date() }).where(eq(measurementCertificateFieldLines.id, id));
        const [created] = await tx.insert(measurementCertificateFieldLines).values(values(existing.certificateLineId, parsed.data, request.currentUser!.id, { revisionNo: existing.revisionNo + 1, supersedesLineId: existing.id })).returning();
        const totals = await recompute(tx, existing.certificateLineId, parsed.data.overrunReason); return { created, totals };
      });
      await recordAuditEvent({ companyId, projectId: context.certificate.projectId, actorUserId: request.currentUser!.id, entityType: "measurement_certificate_field_line", entityId: result.created.id, action: "revised", before: { supersededId: existing.id, revisionNo: existing.revisionNo }, after: { revisionNo: result.created.revisionNo, partial: partialOf(result.created), periodQty: result.totals.periodQty } });
      return { ...result.created, partial: partialOf(result.created), ...result.totals };
    } catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível rever a medição" }); }
  });

  app.delete("/api/measurement-certificate-field-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string }; const companyId = request.currentUser!.companyId!;
    const [existing] = await db.select().from(measurementCertificateFieldLines).where(and(eq(measurementCertificateFieldLines.id, id), eq(measurementCertificateFieldLines.isActive, true))).limit(1);
    const context = existing ? await ownedContext(existing.certificateLineId, companyId) : null;
    if (!existing || !context) return reply.code(404).send({ error: "Medição de campo não encontrada" });
    try {
      const totals = await db.transaction(async (tx) => {
        await tx.update(measurementCertificateFieldLines).set({ isActive: false, updatedAt: new Date() }).where(eq(measurementCertificateFieldLines.id, id));
        return recompute(tx, existing.certificateLineId);
      });
      await recordAuditEvent({ companyId, projectId: context.certificate.projectId, actorUserId: request.currentUser!.id, entityType: "measurement_certificate_field_line", entityId: existing.id, action: "deactivated", before: { revisionNo: existing.revisionNo, partial: partialOf(existing) }, after: { periodQty: totals.periodQty } });
      return { ok: true, ...totals };
    } catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível remover a medição" }); }
  });
}
