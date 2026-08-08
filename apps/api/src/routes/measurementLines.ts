import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementLines, budgetSections, budgetDocuments, lineItems, costCompositions } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertLineItemOwned } from "../services/accessControl.js";
import { getMeasurementLines, recomputeItemQuantity, computePartial } from "../services/dimensionEngine.js";
import { buildMeasurementLinesFromPlant, loadProjectPlantContext } from "../services/plantMeasurementLink.js";
import { documentLockedMessage } from "../services/documentRules.js";
import {
  MEASUREMENT_FORMULA_TYPES,
  calculateMeasurementPartial,
  recommendedFormulaForUnit,
  type MeasurementFormulaType,
} from "../services/measurementFormulaEngine.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;
const SOURCE_VALUES = ["manual", "plant", "import", "bim", "field"] as const;

const lineSchema = z.object({
  description: z.string().max(300).default(""),
  formulaType: z.enum(MEASUREMENT_FORMULA_TYPES).optional(),
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
  block: z.string().max(100).nullable().optional(),
  floor: z.string().max(100).nullable().optional(),
  zone: z.string().max(120).nullable().optional(),
  room: z.string().max(160).nullable().optional(),
  axis: z.string().max(120).nullable().optional(),
  element: z.string().max(160).nullable().optional(),
  source: z.enum(SOURCE_VALUES).default("manual"),
  sourceRef: z.string().max(300).nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

type LineInput = z.infer<typeof lineSchema>;

async function assertMeasurementLineOwned(measurementLineId: string, companyId: string) {
  const [line] = await db.select().from(measurementLines).where(and(eq(measurementLines.id, measurementLineId), eq(measurementLines.isActive, true))).limit(1);
  if (!line) return null;
  const item = await assertLineItemOwned(line.lineItemId, companyId);
  return item ? line : null;
}

async function getItemDocument(lineItemId: string) {
  const [row] = await db
    .select({ document: budgetDocuments })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .where(eq(lineItems.id, lineItemId))
    .limit(1);
  return row?.document ?? null;
}

function effectiveFormulaType(data: LineInput): MeasurementFormulaType {
  return data.formulaType ?? "legacy_product";
}

async function resolveDefaultFormula(item: { unit: string | null; compositionId: string | null }): Promise<MeasurementFormulaType> {
  if (item.compositionId) {
    const [composition] = await db
      .select({ defaultMeasurementFormula: costCompositions.defaultMeasurementFormula })
      .from(costCompositions)
      .where(eq(costCompositions.id, item.compositionId))
      .limit(1);
    if (composition?.defaultMeasurementFormula) {
      return composition.defaultMeasurementFormula as MeasurementFormulaType;
    }
  }
  return recommendedFormulaForUnit(item.unit);
}

function validateCalculatedInput(data: LineInput) {
  return calculateMeasurementPartial({
    formulaType: effectiveFormulaType(data),
    sign: data.sign,
    count: data.count,
    length: data.length,
    width: data.width,
    height: data.height,
    directQuantity: data.directQuantity,
    coefficient: data.coefficient,
    unitWeight: data.unitWeight,
    diameterMm: data.diameterMm,
    baseQuantity: data.baseQuantity,
    percentage: data.percentage,
  });
}

function valuesForInsert(lineItemId: string, data: LineInput, extra?: { revisionNo?: number; supersedesLineId?: string | null }) {
  validateCalculatedInput(data);
  return {
    lineItemId,
    description: data.description,
    formulaType: effectiveFormulaType(data),
    sign: data.sign,
    count: data.count != null ? data.count.toString() : "1",
    length: data.length != null ? data.length.toString() : null,
    width: data.width != null ? data.width.toString() : null,
    height: data.height != null ? data.height.toString() : null,
    directQuantity: data.directQuantity != null ? data.directQuantity.toString() : null,
    coefficient: data.coefficient.toString(),
    unitWeight: data.unitWeight != null ? data.unitWeight.toString() : null,
    diameterMm: data.diameterMm != null ? data.diameterMm.toString() : null,
    baseQuantity: data.baseQuantity != null ? data.baseQuantity.toString() : null,
    percentage: data.percentage != null ? data.percentage.toString() : null,
    block: data.block ?? null,
    floor: data.floor ?? null,
    zone: data.zone ?? null,
    room: data.room ?? null,
    axis: data.axis ?? null,
    element: data.element ?? null,
    source: data.source,
    sourceRef: data.sourceRef ?? null,
    sortOrder: data.sortOrder,
    revisionNo: extra?.revisionNo ?? 1,
    supersedesLineId: extra?.supersedesLineId ?? null,
    isActive: true,
    updatedAt: new Date(),
  };
}

function oldRowAsInput(row: typeof measurementLines.$inferSelect): LineInput {
  return {
    description: row.description,
    formulaType: row.formulaType as MeasurementFormulaType,
    sign: row.sign === -1 ? -1 : 1,
    count: Number(row.count),
    length: row.length == null ? null : Number(row.length),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    directQuantity: row.directQuantity == null ? null : Number(row.directQuantity),
    coefficient: Number(row.coefficient ?? 1),
    unitWeight: row.unitWeight == null ? null : Number(row.unitWeight),
    diameterMm: row.diameterMm == null ? null : Number(row.diameterMm),
    baseQuantity: row.baseQuantity == null ? null : Number(row.baseQuantity),
    percentage: row.percentage == null ? null : Number(row.percentage),
    block: row.block,
    floor: row.floor,
    zone: row.zone,
    room: row.room,
    axis: row.axis,
    element: row.element,
    source: row.source as LineInput["source"],
    sourceRef: row.sourceRef,
    sortOrder: row.sortOrder,
  };
}

async function plantPreview(lineItemId: string, companyId: string) {
  const item = await assertLineItemOwned(lineItemId, companyId);
  if (!item || item.kind !== "item" || !item.code) return null;
  const [projectRow] = await db
    .select({ projectId: budgetDocuments.projectId })
    .from(budgetSections)
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .where(eq(budgetSections.id, item.sectionId))
    .limit(1);
  if (!projectRow) return null;
  const { rooms, openings } = await loadProjectPlantContext(projectRow.projectId);
  const built = buildMeasurementLinesFromPlant(item.code, rooms, openings);
  if (!built.ok) return { ok: false as const, reason: built.reason };
  const compositionDefault = await resolveDefaultFormula(item);
  const lines = built.lines.map((line, index) => {
    let formulaType: MeasurementFormulaType = compositionDefault;
    if (line.height != null && line.width != null && line.length != null) formulaType = "volume";
    else if (line.width != null && line.length != null) formulaType = "area";
    else if (line.length != null && formulaType !== "volume" && formulaType !== "area" && formulaType !== "wall_area") formulaType = "length";
    const candidate: LineInput = {
      description: line.description,
      formulaType,
      sign: 1,
      count: line.count,
      length: line.length,
      width: line.width,
      height: line.height,
      coefficient: 1,
      source: "plant",
      sourceRef: `plant:${projectRow.projectId}`,
      sortOrder: index,
    };
    const calculation = validateCalculatedInput(candidate);
    return { ...candidate, partial: calculation.partial, expression: calculation.expression };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(lines.map(({ partial: _p, expression: _e, ...line }) => line))).digest("hex");
  return { ok: true as const, lines, fingerprint, roomCount: built.roomCount, strategy: built.strategy };
}

export async function measurementLineRoutes(app: FastifyInstance) {
  app.get("/api/line-items/:id/measurements", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item) return reply.code(404).send({ error: "Item não encontrado" });
    return getMeasurementLines(id);
  });

  app.get("/api/line-items/:id/measurements/history", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item) return reply.code(404).send({ error: "Item não encontrado" });
    const rows = await db.select().from(measurementLines).where(eq(measurementLines.lineItemId, id)).orderBy(measurementLines.sortOrder, measurementLines.revisionNo, measurementLines.createdAt);
    return rows.map((row) => ({ ...row, partial: computePartial(row) }));
  });

  app.post("/api/line-items/:id/measurements", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item) return reply.code(404).send({ error: "Item não encontrado" });
    if (item.kind !== "item") return reply.code(400).send({ error: "Só itens têm medições" });
    const document = await getItemDocument(id);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    const parsed = lineSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data: LineInput = {
      ...parsed.data,
      formulaType: parsed.data.formulaType ?? await resolveDefaultFormula(item),
    };
    try { validateCalculatedInput(data); } catch (cause) { return reply.code(400).send({ error: cause instanceof Error ? cause.message : "Fórmula de medição inválida" }); }
    const [row] = await db.insert(measurementLines).values(valuesForInsert(id, data)).returning();
    const newQuantity = await recomputeItemQuantity(id);
    return reply.code(201).send({ ...row, partial: computePartial(row), itemQuantity: newQuantity });
  });

  app.put("/api/measurement-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const existing = await assertMeasurementLineOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Linha de medição não encontrada" });
    const document = await getItemDocument(existing.lineItemId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    const parsed = lineSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const merged = { ...oldRowAsInput(existing), ...parsed.data } as LineInput;
    try { validateCalculatedInput(merged); } catch (cause) { return reply.code(400).send({ error: cause instanceof Error ? cause.message : "Fórmula de medição inválida" }); }
    const row = await db.transaction(async (tx) => {
      await tx.update(measurementLines).set({ isActive: false, updatedAt: new Date() }).where(eq(measurementLines.id, existing.id));
      const [created] = await tx.insert(measurementLines).values(valuesForInsert(existing.lineItemId, merged, { revisionNo: existing.revisionNo + 1, supersedesLineId: existing.id })).returning();
      await recomputeItemQuantity(existing.lineItemId, tx);
      return created;
    });
    const activeLines = await getMeasurementLines(existing.lineItemId);
    const itemQuantity = activeLines.reduce((sum, line) => sum + line.partial, 0);
    return { ...row, partial: computePartial(row), itemQuantity };
  });

  app.delete("/api/measurement-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const existing = await assertMeasurementLineOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Linha de medição não encontrada" });
    const document = await getItemDocument(existing.lineItemId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    await db.update(measurementLines).set({ isActive: false, updatedAt: new Date() }).where(eq(measurementLines.id, id));
    const newQuantity = await recomputeItemQuantity(existing.lineItemId);
    return { ok: true, itemQuantity: newQuantity };
  });

  app.get("/api/line-items/:id/measurement-preview/from-plant", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const preview = await plantPreview(id, companyId);
    if (!preview) return reply.code(404).send({ error: "Item/projecto não encontrado" });
    if (!preview.ok) return reply.code(422).send({ error: preview.reason });
    return preview;
  });

  app.post("/api/line-items/:id/measurement-apply/from-plant", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const item = await assertLineItemOwned(id, companyId);
    if (!item || item.kind !== "item") return reply.code(404).send({ error: "Item não encontrado" });
    const document = await getItemDocument(id);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    const parsed = z.object({
      strategy: z.enum(["replace", "merge"]),
      previewFingerprint: z.string().length(64),
      acceptedIndexes: z.array(z.number().int().nonnegative()).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const preview = await plantPreview(id, companyId);
    if (!preview || !preview.ok) return reply.code(409).send({ error: "Já não é possível reproduzir o preview da planta" });
    if (preview.fingerprint !== parsed.data.previewFingerprint) return reply.code(409).send({ error: "A planta/medição mudou desde o preview. Reveja antes de aplicar." });
    const accepted = parsed.data.acceptedIndexes?.length
      ? preview.lines.filter((_, index) => parsed.data.acceptedIndexes!.includes(index))
      : preview.lines;
    const itemQuantity = await db.transaction(async (tx) => {
      if (parsed.data.strategy === "replace") {
        await tx.update(measurementLines).set({ isActive: false, updatedAt: new Date() }).where(and(eq(measurementLines.lineItemId, id), eq(measurementLines.isActive, true)));
      }
      if (accepted.length) await tx.insert(measurementLines).values(accepted.map((line, index) => valuesForInsert(id, { ...line, sortOrder: index })));
      return recomputeItemQuantity(id, tx);
    });
    return { linesApplied: accepted.length, strategy: parsed.data.strategy, itemQuantity, previewFingerprint: preview.fingerprint };
  });

  app.post("/api/line-items/:id/fill-from-plant", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(409).send({ error: "O preenchimento directo foi substituído por Preview → Aplicar para evitar perda silenciosa da memória de cálculo." });
  });
}
