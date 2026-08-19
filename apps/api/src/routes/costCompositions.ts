import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
  compositionSubcompositionLines,
  compositionDerivedCostLines,
  compositionShares,
  labourCategories,
  materials,
  equipment,
  materialZonePrices,
  users,
} from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { companyScope } from "../services/costEngine.js";
import { computeCompositionUnitCostV2 } from "../services/costEngineV2.js";
import { assertAcyclicCompositionGraph, resolveResourcesByIdentity } from "../services/compositionV2Engine.js";
import { cloneCompositionForCompany, forkCompositionToUser } from "../services/catalogClone.js";
import { costCompositionInputSchema } from "@sigo/shared";
import { z } from "zod";
import { canEditComposition, compositionVisibleCondition, getVisibleComposition, listSharedCompositionIds, matchesCompositionScope, type CompositionActor } from "../services/compositionAccess.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const CATALOG_ROLES = ["super_admin", "admin_empresa", "orcamentista"] as const;

function actorOf(request: FastifyRequest): CompositionActor {
  const user = request.currentUser!;
  return { id: user.id, role: user.role, companyId: user.companyId };
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
    const { zoneId, scope } = request.query as { zoneId?: string; scope?: string };
    const companyId = request.currentUser!.companyId;
    const actor = actorOf(request);
    const visible = await compositionVisibleCondition(actor);
    const rows = await db.select().from(costCompositions).where(visible);
    const sharedIds = new Set(await listSharedCompositionIds(actor.id));
    const filtered = rows.filter((row) => matchesCompositionScope(row, scope, actor, sharedIds, row.id));
    const personal = filtered.filter((row) => row.visibility === "private" || row.visibility === "shared");
    const library = dedupeByName(filtered.filter((row) => row.companyId == null || row.visibility === "company"));
    const catalog = scope === "mine" || scope === "shared" ? filtered : [...personal, ...library];
    const sorted = catalog.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return Promise.all(sorted.map(async (row) => ({ ...row, ...(await computeCompositionUnitCostV2(row.id, companyId, zoneId)) })));
  });

  app.get("/api/catalog/compositions/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { zoneId } = request.query as { zoneId?: string };
    const composition = await getVisibleComposition(id, actorOf(request));
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });

    const [labourLines, materialLines, equipmentLines, subcompositionRows, derivedCostLines, breakdown] = await Promise.all([
      db.select({ id: compositionLabourLines.id, refId: compositionLabourLines.labourCategoryId, qtyPerUnit: compositionLabourLines.qtyPerUnit, notes: compositionLabourLines.notes, name: labourCategories.name, familyKey: labourCategories.familyKey, unitCost: labourCategories.hourlyRate })
        .from(compositionLabourLines).innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id)).where(eq(compositionLabourLines.compositionId, id)),
      db.select({ id: compositionMaterialLines.id, refId: compositionMaterialLines.materialId, qtyPerUnit: compositionMaterialLines.qtyPerUnit, wastePct: compositionMaterialLines.wastePct, notes: compositionMaterialLines.notes, name: materials.name, familyKey: materials.familyKey, unitCost: materials.baseUnitCost, importFactor: materials.importFactor, unit: materials.unit })
        .from(compositionMaterialLines).innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id)).where(eq(compositionMaterialLines.compositionId, id)),
      db.select({ id: compositionEquipmentLines.id, refId: compositionEquipmentLines.equipmentId, qtyPerUnit: compositionEquipmentLines.qtyPerUnit, notes: compositionEquipmentLines.notes, name: equipment.name, familyKey: equipment.familyKey, unitCost: equipment.hourlyCost })
        .from(compositionEquipmentLines).innerJoin(equipment, eq(compositionEquipmentLines.equipmentId, equipment.id)).where(eq(compositionEquipmentLines.compositionId, id)),
      db.select({ id: compositionSubcompositionLines.id, refId: compositionSubcompositionLines.subcompositionId, qtyPerUnit: compositionSubcompositionLines.qtyPerUnit, notes: compositionSubcompositionLines.notes, name: costCompositions.name, outputUnit: costCompositions.outputUnit })
        .from(compositionSubcompositionLines).innerJoin(costCompositions, eq(compositionSubcompositionLines.subcompositionId, costCompositions.id)).where(eq(compositionSubcompositionLines.compositionId, id)),
      db.select().from(compositionDerivedCostLines).where(eq(compositionDerivedCostLines.compositionId, id)),
      computeCompositionUnitCostV2(id, request.currentUser!.companyId, zoneId),
    ]);

    const requestingCompanyId = request.currentUser!.companyId;
    const labourFamilies = Array.from(new Set(labourLines.map((line) => line.familyKey)));
    const materialFamilies = Array.from(new Set(materialLines.map((line) => line.familyKey)));
    const equipmentFamilies = Array.from(new Set(equipmentLines.map((line) => line.familyKey)));
    const [labourCandidates, materialCandidates, equipmentCandidates] = await Promise.all([
      labourFamilies.length
        ? db.select({ id: labourCategories.id, familyKey: labourCategories.familyKey, name: labourCategories.name, companyId: labourCategories.companyId, unitCost: labourCategories.hourlyRate })
            .from(labourCategories).where(and(inArray(labourCategories.familyKey, labourFamilies), companyScope(labourCategories.companyId, requestingCompanyId)))
        : Promise.resolve([]),
      materialFamilies.length
        ? db.select({ id: materials.id, familyKey: materials.familyKey, name: materials.name, companyId: materials.companyId, unitCost: materials.baseUnitCost, importFactor: materials.importFactor, unit: materials.unit })
            .from(materials).where(and(inArray(materials.familyKey, materialFamilies), companyScope(materials.companyId, requestingCompanyId)))
        : Promise.resolve([]),
      equipmentFamilies.length
        ? db.select({ id: equipment.id, familyKey: equipment.familyKey, name: equipment.name, companyId: equipment.companyId, unitCost: equipment.hourlyCost })
            .from(equipment).where(and(inArray(equipment.familyKey, equipmentFamilies), companyScope(equipment.companyId, requestingCompanyId)))
        : Promise.resolve([]),
    ]);
    const resolvedLabour = resolveResourcesByIdentity(labourCandidates);
    const resolvedMaterials = resolveResourcesByIdentity(materialCandidates);
    const resolvedEquipment = resolveResourcesByIdentity(equipmentCandidates);
    const resolvedLabourLines = labourLines.map((line) => {
      const resolved = resolvedLabour.get(line.familyKey);
      return { ...line, name: resolved?.name ?? line.name, unitCost: resolved?.unitCost ?? line.unitCost };
    });
    const resolvedMaterialLines = materialLines.map((line) => {
      const resolved = resolvedMaterials.get(line.familyKey);
      return {
        ...line,
        name: resolved?.name ?? line.name,
        unitCost: resolved?.unitCost ?? line.unitCost,
        importFactor: resolved?.importFactor ?? line.importFactor,
        unit: resolved?.unit ?? line.unit,
      };
    });
    if (zoneId && resolvedMaterialLines.length) {
      const resolvedIds = [...resolvedMaterials.values()].map((row) => row.id);
      const zonePrices = resolvedIds.length
        ? await db.select().from(materialZonePrices).where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, resolvedIds)))
        : [];
      const priceByMaterial = new Map(zonePrices.map((price) => [price.materialId, price.unitCost]));
      for (const line of resolvedMaterialLines) {
        const materialId = resolvedMaterials.get(line.familyKey)?.id;
        if (materialId && priceByMaterial.has(materialId)) line.unitCost = priceByMaterial.get(materialId)!;
      }
    }
    return {
      ...composition,
      labourLines: resolvedLabourLines,
      materialLines: resolvedMaterialLines,
      equipmentLines: equipmentLines.map((line) => {
        const resolved = resolvedEquipment.get(line.familyKey);
        return { ...line, name: resolved?.name ?? line.name, unitCost: resolved?.unitCost ?? line.unitCost };
      }),
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
        const [composition] = await tx.insert(costCompositions).values({
          ...data,
          companyId,
          ownerUserId: request.currentUser!.id,
          visibility: companyId ? "private" : "global",
          auxiliaryCostPct: "0",
          indirectCostPct: "0",
          profitMarginPct: "0",
          crewSize: data.crewSize ?? null,
          productiveHoursPerDay: data.productiveHoursPerDay?.toString() ?? null,
          outputPerDay: data.outputPerDay?.toString() ?? null,
        }).returning();
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
    const actor = actorOf(request);
    let target = await getVisibleComposition(id, actor);
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });
    if (!(await canEditComposition(target, actor))) {
      if (target.companyId == null && companyId) {
        const cloned = await cloneCompositionForCompany(id, companyId);
        if (!cloned) return reply.code(404).send({ error: "Composição não encontrada" });
        target = cloned;
      } else {
        return reply.code(403).send({ error: "Sem permissão para editar esta composição" });
      }
    }
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
      if (companyId) {
        await recordAuditEvent({
          companyId,
          actorUserId: actor.id,
          entityType: "cost_composition",
          entityId: target.id,
          action: "version",
          metadata: { version: updated?.version ?? target.version + 1 },
        });
      }
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
    const actor = actorOf(request);
    let target = await getVisibleComposition(id, actor);
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });
    if (!(await canEditComposition(target, actor))) {
      if (target.companyId == null && companyId) {
        const cloned = await cloneCompositionForCompany(id, companyId);
        if (!cloned) return reply.code(404).send({ error: "Composição não encontrada" });
        target = cloned;
      } else {
        return reply.code(403).send({ error: "Sem permissão para editar esta composição" });
      }
    }
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
    const actor = actorOf(request);
    const target = await getVisibleComposition(id, actor);
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });
    if (!(await canEditComposition(target, actor))) return reply.code(403).send({ error: "Sem permissão para eliminar esta composição" });
    const usedAsSubcomposition = await db.select({ id: compositionSubcompositionLines.id }).from(compositionSubcompositionLines).where(eq(compositionSubcompositionLines.subcompositionId, id)).limit(1);
    if (usedAsSubcomposition.length) return reply.code(409).send({ error: "Esta composição é usada como subcomposição e não pode ser eliminada." });
    await db.delete(costCompositions).where(eq(costCompositions.id, id));
    return { ok: true };
  });

  app.post("/api/catalog/compositions/:id/fork", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = actorOf(request);
    const companyId = targetCompanyId(request);
    if (!companyId) return reply.code(400).send({ error: "Apenas empresas podem duplicar composições" });
    const source = await getVisibleComposition(id, actor);
    if (!source) return reply.code(404).send({ error: "Composição não encontrada" });
    const { assertCustomCompositionSlot } = await import("../services/subscriptionEntitlements.js");
    const block = await assertCustomCompositionSlot(companyId);
    if (block) return reply.code(403).send({ error: block.error, code: block.code, upgradeHint: block.upgradeHint, actionPath: block.actionPath });
    const copy = await forkCompositionToUser(id, companyId, actor.id);
    if (!copy) return reply.code(404).send({ error: "Composição não encontrada" });
    const breakdown = await computeCompositionUnitCostV2(copy.id, companyId);
    return reply.code(201).send({ ...copy, ...breakdown });
  });

  app.get("/api/catalog/compositions/:id/shares", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = actorOf(request);
    const composition = await getVisibleComposition(id, actor);
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });
    if (composition.ownerUserId !== actor.id && actor.role !== "admin_empresa") return reply.code(403).send({ error: "Sem permissão para ver partilhas" });
    const rows = await db
      .select({
        id: compositionShares.id,
        userId: compositionShares.userId,
        permission: compositionShares.permission,
        email: users.email,
        name: users.name,
      })
      .from(compositionShares)
      .innerJoin(users, eq(compositionShares.userId, users.id))
      .where(eq(compositionShares.compositionId, id));
    return { visibility: composition.visibility, ownerUserId: composition.ownerUserId, shares: rows };
  });

  app.post("/api/catalog/compositions/:id/shares", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = actorOf(request);
    const composition = await getVisibleComposition(id, actor);
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });
    if (composition.ownerUserId !== actor.id) return reply.code(403).send({ error: "Só o dono pode partilhar" });
    const parsed = z.object({ email: z.string().email(), permission: z.enum(["view", "edit"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [colleague] = await db.select().from(users).where(and(eq(users.email, parsed.data.email.toLowerCase()), eq(users.companyId, actor.companyId!))).limit(1);
    if (!colleague) return reply.code(404).send({ error: "Utilizador não encontrado nesta empresa" });
    if (colleague.id === actor.id) return reply.code(400).send({ error: "Não é possível partilhar consigo próprio" });
    await db.update(costCompositions).set({ visibility: "shared", updatedAt: new Date() }).where(eq(costCompositions.id, id));
    const [share] = await db.insert(compositionShares).values({
      compositionId: id,
      userId: colleague.id,
      permission: parsed.data.permission,
      createdByUserId: actor.id,
    }).onConflictDoUpdate({
      target: [compositionShares.compositionId, compositionShares.userId],
      set: { permission: parsed.data.permission },
    }).returning();
    return reply.code(201).send(share);
  });

  app.delete("/api/catalog/compositions/:id/shares/:userId", auth, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const actor = actorOf(request);
    const composition = await getVisibleComposition(id, actor);
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });
    if (composition.ownerUserId !== actor.id) return reply.code(403).send({ error: "Só o dono pode revogar partilha" });
    await db.delete(compositionShares).where(and(eq(compositionShares.compositionId, id), eq(compositionShares.userId, userId)));
    const remaining = await db.select({ id: compositionShares.id }).from(compositionShares).where(eq(compositionShares.compositionId, id)).limit(1);
    if (!remaining.length) await db.update(costCompositions).set({ visibility: "private", updatedAt: new Date() }).where(eq(costCompositions.id, id));
    return { ok: true };
  });
}
