import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementLines } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertLineItemOwned } from "../services/accessControl.js";
import { getMeasurementLines, recomputeItemQuantity, computePartial } from "../services/dimensionEngine.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const lineSchema = z.object({
  description: z.string().max(300).default(""),
  count: z.number().positive().default(1),
  length: z.number().positive().nullable().optional(),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

async function assertMeasurementLineOwned(measurementLineId: string, companyId: string) {
  const [line] = await db.select().from(measurementLines).where(eq(measurementLines.id, measurementLineId)).limit(1);
  if (!line) return null;
  const item = await assertLineItemOwned(line.lineItemId, companyId);
  return item ? line : null;
}

export async function measurementLineRoutes(app: FastifyInstance) {
  app.get("/api/line-items/:id/measurements", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item) return reply.code(404).send({ error: "Item não encontrado" });
    return getMeasurementLines(id);
  });

  app.post("/api/line-items/:id/measurements", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item) return reply.code(404).send({ error: "Item não encontrado" });
    if (item.kind !== "item") return reply.code(400).send({ error: "Só itens (não capítulos/grupos/notas) têm medições" });

    const parsed = lineSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;

    const [row] = await db
      .insert(measurementLines)
      .values({
        lineItemId: id,
        description: data.description,
        count: data.count.toString(),
        length: data.length != null ? data.length.toString() : null,
        width: data.width != null ? data.width.toString() : null,
        height: data.height != null ? data.height.toString() : null,
        sortOrder: data.sortOrder,
      })
      .returning();

    const newQuantity = await recomputeItemQuantity(id);
    return reply.code(201).send({ ...row, partial: computePartial(row), itemQuantity: newQuantity });
  });

  app.put("/api/measurement-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const existing = await assertMeasurementLineOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Linha de medição não encontrada" });

    const parsed = lineSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;

    const [row] = await db
      .update(measurementLines)
      .set({
        description: data.description,
        count: data.count !== undefined ? data.count.toString() : undefined,
        length: data.length !== undefined ? (data.length !== null ? data.length.toString() : null) : undefined,
        width: data.width !== undefined ? (data.width !== null ? data.width.toString() : null) : undefined,
        height: data.height !== undefined ? (data.height !== null ? data.height.toString() : null) : undefined,
        sortOrder: data.sortOrder,
      })
      .where(eq(measurementLines.id, id))
      .returning();

    const newQuantity = await recomputeItemQuantity(existing.lineItemId);
    return { ...row, partial: computePartial(row), itemQuantity: newQuantity };
  });

  app.delete("/api/measurement-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const existing = await assertMeasurementLineOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Linha de medição não encontrada" });

    await db.delete(measurementLines).where(eq(measurementLines.id, id));
    const newQuantity = await recomputeItemQuantity(existing.lineItemId);
    return { ok: true, itemQuantity: newQuantity };
  });
}
