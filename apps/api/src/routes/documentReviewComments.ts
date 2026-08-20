import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, documentReviewComments, lineItems, projects, users } from "../db/schema.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const targetTypeSchema = z.enum(["document", "section", "line_item", "measurement_line"]);

async function assertLineItemOnDocument(lineItemId: string, documentId: string, companyId: string) {
  const [row] = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(
      and(
        eq(lineItems.id, lineItemId),
        eq(budgetDocuments.id, documentId),
        eq(projects.companyId, companyId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function documentReviewCommentRoutes(app: FastifyInstance) {
  app.get("/api/budget-documents/:id/review-comments", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const query = z
      .object({
        targetType: targetTypeSchema.optional(),
        targetId: z.string().uuid().optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });

    const filters = [eq(documentReviewComments.documentId, id), eq(documentReviewComments.companyId, companyId)];
    if (query.data.targetType) filters.push(eq(documentReviewComments.targetType, query.data.targetType));
    if (query.data.targetId) filters.push(eq(documentReviewComments.targetId, query.data.targetId));

    const rows = await db
      .select({
        id: documentReviewComments.id,
        documentId: documentReviewComments.documentId,
        targetType: documentReviewComments.targetType,
        targetId: documentReviewComments.targetId,
        targetLabelSnapshot: documentReviewComments.targetLabelSnapshot,
        authorUserId: documentReviewComments.authorUserId,
        authorName: users.name,
        comment: documentReviewComments.comment,
        parentCommentId: documentReviewComments.parentCommentId,
        resolvedAt: documentReviewComments.resolvedAt,
        resolvedByUserId: documentReviewComments.resolvedByUserId,
        createdAt: documentReviewComments.createdAt,
      })
      .from(documentReviewComments)
      .innerJoin(users, eq(users.id, documentReviewComments.authorUserId))
      .where(and(...filters))
      .orderBy(desc(documentReviewComments.createdAt))
      .limit(200);

    return { items: rows };
  });

  app.post("/api/budget-documents/:id/review-comments", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const parsed = z
      .object({
        targetType: targetTypeSchema.default("document"),
        targetId: z.string().uuid().nullable().optional(),
        targetLabelSnapshot: z.string().max(300).nullable().optional(),
        comment: z.string().trim().min(1).max(4000),
        parentCommentId: z.string().uuid().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    if (parsed.data.targetType === "line_item" && parsed.data.targetId) {
      const ok = await assertLineItemOnDocument(parsed.data.targetId, id, companyId);
      if (!ok) return reply.code(400).send({ error: "Item inválido para este documento" });
    }

    const [created] = await db
      .insert(documentReviewComments)
      .values({
        companyId,
        projectId: document.projectId,
        documentId: id,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId ?? null,
        targetLabelSnapshot: parsed.data.targetLabelSnapshot ?? null,
        authorUserId: request.currentUser!.id,
        comment: parsed.data.comment,
        parentCommentId: parsed.data.parentCommentId ?? null,
      })
      .returning();

    await recordAuditEvent({
      companyId,
      projectId: document.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "budget_document",
      entityId: id,
      action: "review.comment.created",
      after: { commentId: created.id, targetType: created.targetType, targetId: created.targetId },
    });

    return created;
  });

  app.post("/api/review-comments/:commentId/resolve", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string };
    const companyId = companyIdOf(request);
    const [row] = await db
      .select()
      .from(documentReviewComments)
      .where(and(eq(documentReviewComments.id, commentId), eq(documentReviewComments.companyId, companyId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Comentário não encontrado" });
    if (row.resolvedAt) return row;

    const [updated] = await db
      .update(documentReviewComments)
      .set({ resolvedAt: new Date(), resolvedByUserId: request.currentUser!.id })
      .where(and(eq(documentReviewComments.id, commentId), isNull(documentReviewComments.resolvedAt)))
      .returning();

    await recordAuditEvent({
      companyId,
      projectId: row.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "budget_document",
      entityId: row.documentId,
      action: "review.comment.resolved",
      after: { commentId },
    });

    return updated;
  });
}
