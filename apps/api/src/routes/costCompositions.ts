import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, isNull, or, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
  compositionSubcompositionLines,
  compositionDerivedCostLines,
  labourCategories,
  materials,
  equipment,
  materialZonePrices,
} from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { resolveByName, companyScope } from "../services/costEngine.js";
import { computeCompositionUnitCostV2 } from "../services/costEngineV2.js";
import { assertAcyclicCompositionGraph } from "../services/compositionV2Engine.js";
import { cloneCompositionForCompany } from "../services/catalogClone.js";
import { costCompositionInputSchema } from "@sigo/shared";

const CATALOG_ROLES = ["super_admin", "admin_empresa", "orcamentista"] as const;

function scopeFilter(request: FastifyRequest) {
  const { role, companyId } = request.currentUser!;
  if (role === "super_admin") return isNull(costCompositions.companyId);
  return or(isNull(costCompositions.companyId), eq(costCompositions.companyId, companyId!));
}
function targetCompanyId(request: FastifyRequest): string | null {
  const { role, companyId } = request.currentUser!;
  return role === "super_admin" ? null : companyId!;
}
function dedupeByName<T extends { name: string; companyId: string | null }>(rows: T[]): T[] {
  const byName = new Map<string, T>();
  for (const row of rows) {
    const current = byName.get(row.name);
    if (!current || (current.companyId === null && row.companyId !== null)) byName.set(row.name, row);
  }
  return Array.from(byName.values());
}

async function validateSubcompositionGraph(compositionId: string, proposed: Array<{ refId: string; qtyPerUnit: number }>) {
  if (proposed.some((line) => line.refId === compositionId)) throw new Error("Uma composição não pode consumir-se a si própria");
  const existing = await db.select().from(compositionSubcompositionLines);
  const edges = existing
    .filter((line) => line.compositionId !== compositionId)
    .map((line) => ({ compositionId: line.compositionId, subcompositionId: line.subcompositionId, qtyPerUnit: Number(line.qtyPerUnit) }));
  edges.push(...proposed.map((line) => ({ compositionId, subcompositionId: line.refId, qtyPerUnit: line.qtyPerUnit })));
  assertAcyclicCompositionGraph(compositionId, edges);
}

async function replaceV2Lines(
  executor: any,
  compositionId: string,
  input: {
    labourLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
    materialLines: Array<{ refId: string; qtyPerUnit: number; wastePct?: number; notes?: string | null }>;
    equipmentLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
    subcompositionLines: Array<{ refId: string; qtyPerUnit: number; notes?: string | null }>;
    derivedCostLines: Array<{ name: string; basis: string; percentage: number; notes?: string | null }>;
  },
) {
  // Não correr queries paralelas dentro da mesma transacção/ligação PostgreSQL.
  // Mantém a operação determinística também em drivers que não suportam multiplexing.
  await executor.delete(compositionLabourLines).where(eq(compositionLabourLines.compositionId, compositionId));
  await executor.delete(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, compositionId));
  await executor.delete(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, compositionId));
  await executor.delete(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, compositionId));
  await executor.delete(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, compositionId));
  if (input.labourLines.length) await executor.insert(compositionLabourLines).values(input.labourLines.map((line) => ({ compositionId, labourCategoryId: line.refId, qtyPerUnit: line.qtyPerUnit.toString(), notes: line.notes ?? null })));
  if (input.materialLines.length) await executor.insert(compositionMaterialLines).values(input.materialLines.map((line) => ({ compositionId, materialId: line.refId, qtyPerUnit: line.qtyPerUnit.toString(), wastePct: (line.wastePct ?? 0).toString(), notes: line.notes ?? null })));
  if (input.equipmentLines.length) await executor.insert(compositionEquipmentLines).values(input.equipmentLines.map((line) => ({ compositionId, equipmentId: line.refId, qtyPerUnit: line.qtyPerUnit.toString(), notes: line.notes ?? null })));
  if (input.subcompositionLines.length) await executor.insert(compositionSubcompositionLines).values(input.subcompositionLines.map((line) => ({ compositionId, subcompositionId: line.refId, qtyPerUnit: line.qtyPerUnit.toString(), notes: line.notes ?? null })));
  if (input.derivedCostLines.length) await executor.insert(compositionDerivedCostLines).values(input.derivedCostLines.map((line) => ({ compositionId, name: line.name, basis: line.basis, percentage: line.percentage.toString(), notes: line.notes ?? null })));
}

const technicalV2Schema = costCompositionInputSchema.pick({
  crewSize: true,
  productiveHoursPerDay: true,
  outputPerDay: true,
  productivitySource: true,
  productivityNotes: true,
  defaultMeasurementFormula: true,
  subcompositionLines: true,
  derivedCostLines: true,
});

export async function costCompositionRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRole(...CATALOG_ROLES) };

  app.get("/api/catalog/compositions", auth, async (request: FastifyRequest) => {
    const { zoneId } = request.query as { zoneId?: string };
    const companyId = request.currentUser!.companyId;
    const rows = await db.select().from(costCompositions).where(scopeFilter(request));
    const deduped = dedupeByName(rows).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return Promise.all(deduped.map(async (row) => ({ ...row, ...(await computeCompositionUnitCostV2(row.id, companyId, zoneId)) })));
  });

  app.get("/api/catalog/compositions/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { zoneId } = request.query as { zoneId?: string };
    const [composition] = await db.select().from(costCompositions).where(and(eq(costCompositions.id, id), scopeFilter(request))).limit(1);
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });

    const [labourLines, materialLines, equipmentLines, subcompositionRows, derivedCostLines, breakdown] = await Promise.all([
      db.select({ id: compositionLabourLines.id, refId: compositionLabourLines.labourCategoryId, qtyPerUnit: compositionLabourLines.qtyPerUnit, notes: compositionLabourLines.notes, name: labourCategories.name, unitCost: labourCategories.hourlyRate })
        .from(compositionLabourLines).innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id)).where(eq(compositionLabourLines.compositionId, id)),
      db.select({ id: compositionMaterialLines.id, refId: compositionMaterialLines.materialId, qtyPerUnit: compositionMaterialLines.qtyPerUnit, wastePct: compositionMaterialLines.wastePct, notes: compositionMaterialLines.notes, name: materials.name, unitCost: materials.baseUnitCost, importFactor: materials.importFactor, unit: materials.unit })
        .from(compositionMaterialLines).innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id)).where(eq(compositionMaterialLines.compositionId, id)),
      db.select({ id: compositionEquipmentLines.id, refId: compositionEquipmentLines.equipmentId, qtyPerUnit: compositionEquipmentLines.qtyPerUnit, notes: compositionEquipmentLines.notes, name: equipment.name, unitCost: equipment.hourlyCost })
        .from(compositionEquipmentLines).innerJoin(equipment, eq(compositionEquipmentLines.equipmentId, equipment.id)).where(eq(compositionEquipmentLines.compositionId, id)),
      db.select({ id: compositionSubcompositionLines.id, refId: compositionSubcompositionLines.subcompositionId, qtyPerUnit: compositionSubcompositionLines.qtyPerUnit, notes: compositionSubcompositionLines.notes, name: costCompositions.name, outputUnit: costCompositions.outputUnit })
        .from(compositionSubcompositionLines).innerJoin(costCompositions, eq(compositionSubcompositionLines.subcompositionId, costCompositions.id)).where(eq(compositionSubcompositionLines.compositionId, id)),
      db.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, id)),
      computeCompositionUnitCostV2(id, request.currentUser!.companyId, zoneId),
    ]);

    const requestingCompanyId = request.currentUser!.companyId;
    const labourNames = Array.from(new Set(labourLines.map((line) => line.name)));
    const materialNames = Array.from(new Set(materialLines.map((line) => line.name)));
    const equipmentNames = Array.from(new Set(equipmentLines.map((line) => line.name)));
    const [resolvedLabour, resolvedMaterials, resolvedEquipment] = await Promise.all([
      labourNames.length ? resolveByName(await db.select({ id: labourCategories.id, name: labourCategories.name, companyId: labourCategories.companyId, unitCost: labourCategories.hourlyRate }).from(labourCategories).where(and(inArray(labourCategories.name, labourNames), companyScope(labourCategories.companyId, requestingCompanyId)))) : new Map(),
      materialNames.length ? resolveByName(await db.select({ id: materials.id, name: materials.name, companyId: materials.companyId, unitCost: materials.baseUnitCost, importFactor: materials.importFactor, unit: materials.unit }).from(materials).where(and(inArray(materials.name, materialNames), companyScope(materials.companyId, requestingCompanyId)))) : new Map(),
      equipmentNames.length ? resolveByName(await db.select({ id: equipment.id, name: equipment.name, companyId: equipment.companyId, unitCost: equipment.hourlyCost }).from(equipment).where(and(inArray(equipment.name, equipmentNames), companyScope(equipment.companyId, requestingCompanyId)))) : new Map(),
    ]);
    const resolvedLabourLines = labourLines.map((line) => ({ ...line, unitCost: resolvedLabour.get(line.name)?.unitCost ?? line.unitCost }));
    const resolvedMaterialLines = materialLines.map((line) => {
      const resolved = resolvedMaterials.get(line.name);
      return { ...line, unitCost: resolved?.unitCost ?? line.unitCost, importFactor: resolved?.importFactor ?? line.importFactor, unit: resolved?.unit ?? line.unit };
    });
    if (zoneId && resolvedMaterialLines.length) {
      const resolvedIds = resolvedMaterialLines.map((line) => resolvedMaterials.get(line.name)?.id).filter((value): value is string => Boolean(value));
      const zonePrices = resolvedIds.length ? await db.select().from(materialZonePrices).where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, resolvedIds))) : [];
      const priceByMaterial = new Map(zonePrices.map((price) => [price.materialId, price.unitCost]));
      for (const line of resolvedMaterialLines) {
        const materialId = resolvedMaterials.get(line.name)?.id;
        if (materialId && priceByMaterial.has(materialId)) line.unitCost = priceByMaterial.get(materialId)!;
      }
    }
    return {
      ...composition,
      labourLines: resolvedLabourLines,
      materialLines: resolvedMaterialLines,
      equipmentLines: equipmentLines.map((line) => ({ ...line, unitCost: resolvedEquipment.get(line.name)?.unitCost ?? line.unitCost })),
      subcompositionLines: subcompositionRows,
      ...breakdown,
      derivedCostLines,
      derivedOutputPerDay: breakdown.productivity.outputPerDay,
      productivityBasis: breakdown.productivity.basis,
    };
  });

  app.post("/api/catalog/compositions", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = costCompositionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourLines, materialLines, equipmentLines, subcompositionLines, derivedCostLines, ...data } = parsed.data;
    const companyId = targetCompanyId(request);
    if (companyId) {
      const { assertCustomCompositionSlot } = await import("../services/subscriptionEntitlements.js");
      const block = await assertCustomCompositionSlot(companyId);
      if (block) return reply.code(403).send({ error: block.error, code: block.code, upgradeHint: block.upgradeHint, actionPath: block.actionPath });
    }
    try {
      const created = await db.transaction(async (tx) => {
        const [composition] = await tx.insert(costCompositions).values({ ...data, companyId, auxiliaryCostPct: "0", indirectCostPct: "0", profitMarginPct: "0", crewSize: data.crewSize ?? null, productiveHoursPerDay: data.productiveHoursPerDay?.toString() ?? null, outputPerDay: data.outputPerDay?.toString() ?? null }).returning();
        await validateSubcompositionGraph(composition.id, subcompositionLines);
        await replaceV2Lines(tx, composition.id, { labourLines, materialLines, equipmentLines, subcompositionLines, derivedCostLines });
        return composition;
      });
      const breakdown = await computeCompositionUnitCostV2(created.id, companyId);
      return reply.code(201).send({ ...created, ...breakdown });
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível criar a composição" });
    }
  });

  app.put("/api/catalog/compositions/:id", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const companyId = targetCompanyId(request);
    let [target] = await db.select().from(costCompositions).where(and(eq(costCompositions.id, id), companyId ? eq(costCompositions.companyId, companyId) : isNull(costCompositions.companyId))).limit(1);
    if (!target && companyId) { const cloned = await cloneCompositionForCompany(id, companyId); if (!cloned) return reply.code(404).send({ error: "Composição não encontrada" }); target = cloned; }
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });
    const parsed = costCompositionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourLines, materialLines, equipmentLines, subcompositionLines, derivedCostLines, ...data } = parsed.data;
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    const preservesTechnicalV2 = !("subcompositionLines" in rawBody) && !("derivedCostLines" in rawBody)
      && !("crewSize" in rawBody) && !("productiveHoursPerDay" in rawBody) && !("outputPerDay" in rawBody)
      && !("productivitySource" in rawBody) && !("productivityNotes" in rawBody) && !("defaultMeasurementFormula" in rawBody);
    try {
      const effectiveSubs = preservesTechnicalV2
        ? (await db.select().from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, target.id))).map((line) => ({ refId: line.subcompositionId, qtyPerUnit: Number(line.qtyPerUnit), notes: line.notes }))
        : subcompositionLines;
      const effectiveDerived = preservesTechnicalV2
        ? (await db.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, target.id))).map((line) => ({ name: line.name, basis: line.basis as "materials" | "labour" | "equipment" | "subcompositions" | "direct", percentage: Number(line.percentage), notes: line.notes }))
        : derivedCostLines;
      await validateSubcompositionGraph(target.id, effectiveSubs);
      await db.transaction(async (tx) => {
        const {
          crewSize: _crewSize,
          productiveHoursPerDay: _productiveHoursPerDay,
          outputPerDay: _outputPerDay,
          productivitySource: _productivitySource,
          productivityNotes: _productivityNotes,
          defaultMeasurementFormula: _defaultMeasurementFormula,
          ...restData
        } = data;
        const technicalSet = preservesTechnicalV2 ? {} : {
          crewSize: data.crewSize ?? null,
          productiveHoursPerDay: data.productiveHoursPerDay?.toString() ?? null,
          outputPerDay: data.outputPerDay?.toString() ?? null,
          productivitySource: data.productivitySource ?? null,
          productivityNotes: data.productivityNotes ?? null,
          defaultMeasurementFormula: data.defaultMeasurementFormula ?? null,
        };
        await tx.update(costCompositions).set({ ...restData, ...technicalSet, auxiliaryCostPct: "0", indirectCostPct: "0", profitMarginPct: "0", version: target.version + 1, updatedAt: new Date() }).where(eq(costCompositions.id, target.id));
        await replaceV2Lines(tx, target.id, { labourLines, materialLines, equipmentLines, subcompositionLines: effectiveSubs, derivedCostLines: effectiveDerived });
      });
      const breakdown = await computeCompositionUnitCostV2(target.id, companyId);
      const [updated] = await db.select().from(costCompositions).where(eq(costCompositions.id, target.id)).limit(1);
      return { ...updated, ...breakdown };
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível actualizar a composição" });
    }
  });

  // Editor técnico V2 separado do formulário legado. Assim clientes/frontends antigos podem
  // continuar a gravar materiais/MO/equipamento sem limpar produtividade/subcomposições.
  app.put("/api/catalog/compositions/:id/technical-v2", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const companyId = targetCompanyId(request);
    let [target] = await db.select().from(costCompositions).where(and(eq(costCompositions.id, id), companyId ? eq(costCompositions.companyId, companyId) : isNull(costCompositions.companyId))).limit(1);
    if (!target && companyId) {
      const cloned = await cloneCompositionForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Composição não encontrada" });
      target = cloned;
    }
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });
    const parsed = technicalV2Schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await validateSubcompositionGraph(target.id, parsed.data.subcompositionLines);
      await db.transaction(async (tx) => {
        await tx.update(costCompositions).set({
          crewSize: parsed.data.crewSize ?? null,
          productiveHoursPerDay: parsed.data.productiveHoursPerDay?.toString() ?? null,
          outputPerDay: parsed.data.outputPerDay?.toString() ?? null,
          productivitySource: parsed.data.productivitySource ?? null,
          productivityNotes: parsed.data.productivityNotes ?? null,
          defaultMeasurementFormula: parsed.data.defaultMeasurementFormula ?? null,
          version: target.version + 1,
          updatedAt: new Date(),
        }).where(eq(costCompositions.id, target.id));
        await tx.delete(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.compositionId, target.id));
        await tx.delete(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, target.id));
        if (parsed.data.subcompositionLines.length) {
          await tx.insert(compositionSubcompositionLines).values(parsed.data.subcompositionLines.map((line) => ({
            compositionId: target.id, subcompositionId: line.refId, qtyPerUnit: line.qtyPerUnit.toString(), notes: line.notes ?? null,
          })));
        }
        if (parsed.data.derivedCostLines.length) {
          await tx.insert(compositionDerivedCostLines).values(parsed.data.derivedCostLines.map((line) => ({
            compositionId: target.id, name: line.name, basis: line.basis, percentage: line.percentage.toString(), notes: line.notes ?? null,
          })));
        }
      });
      const [updated] = await db.select().from(costCompositions).where(eq(costCompositions.id, target.id)).limit(1);
      const breakdown = await computeCompositionUnitCostV2(target.id, companyId);
      return { ...updated, ...breakdown, derivedOutputPerDay: breakdown.productivity.outputPerDay, productivityBasis: breakdown.productivity.basis };
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível actualizar os parâmetros técnicos" });
    }
  });

  app.delete("/api/catalog/compositions/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = targetCompanyId(request);
    const usedAsSubcomposition = await db.select({ id: compositionSubcompositionLines.id }).from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.subcompositionId, id)).limit(1);
    if (usedAsSubcomposition.length) return reply.code(409).send({ error: "Esta composição é usada como subcomposição e não pode ser eliminada." });
    await db.delete(costCompositions).where(and(eq(costCompositions.id, id), companyId ? eq(costCompositions.companyId, companyId) : isNull(costCompositions.companyId)));
    return { ok: true };
  });
}
