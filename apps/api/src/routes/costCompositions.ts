import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, isNull, or, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
  labourCategories,
  materials,
  equipment,
} from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { computeCompositionUnitCost } from "../services/costEngine.js";
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

// Uma única linha por nome: a versão da empresa tem sempre prioridade sobre a partilhada
// (assim que a empresa edita/clona uma composição, o duplicado global desaparece da lista).
function dedupeByName<T extends { name: string; companyId: string | null }>(rows: T[]): T[] {
  const byName = new Map<string, T>();
  for (const row of rows) {
    const current = byName.get(row.name);
    if (!current || (current.companyId === null && row.companyId !== null)) {
      byName.set(row.name, row);
    }
  }
  return Array.from(byName.values());
}

export async function costCompositionRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRole(...CATALOG_ROLES) };

  app.get("/api/catalog/compositions", auth, async (request: FastifyRequest) => {
    const { zoneId } = request.query as { zoneId?: string };
    const rows = await db.select().from(costCompositions).where(scopeFilter(request));
    const deduped = dedupeByName(rows).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return Promise.all(deduped.map(async (row) => ({ ...row, ...(await computeCompositionUnitCost(row.id, zoneId)) })));
  });

  app.get("/api/catalog/compositions/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Tal como as restantes rotas deste ficheiro: só vê o detalhe de uma composição partilhada
    // (companyId null) ou da própria empresa — nunca a de outra empresa, mesmo sabendo o id.
    const [composition] = await db
      .select()
      .from(costCompositions)
      .where(and(eq(costCompositions.id, id), scopeFilter(request)))
      .limit(1);
    if (!composition) return reply.code(404).send({ error: "Composição não encontrada" });

    // Cada linha vem com o nome e o custo unitário do recurso, para o editor mostrar
    // o build-up completo (recurso × rendimento × custo = subtotal).
    const [labourLines, materialLines, equipmentLines, breakdown] = await Promise.all([
      db
        .select({
          id: compositionLabourLines.id,
          refId: compositionLabourLines.labourCategoryId,
          qtyPerUnit: compositionLabourLines.qtyPerUnit,
          name: labourCategories.name,
          unitCost: labourCategories.hourlyRate,
        })
        .from(compositionLabourLines)
        .innerJoin(labourCategories, eq(compositionLabourLines.labourCategoryId, labourCategories.id))
        .where(eq(compositionLabourLines.compositionId, id)),
      db
        .select({
          id: compositionMaterialLines.id,
          refId: compositionMaterialLines.materialId,
          qtyPerUnit: compositionMaterialLines.qtyPerUnit,
          name: materials.name,
          unitCost: materials.baseUnitCost,
          importFactor: materials.importFactor,
          unit: materials.unit,
        })
        .from(compositionMaterialLines)
        .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
        .where(eq(compositionMaterialLines.compositionId, id)),
      db
        .select({
          id: compositionEquipmentLines.id,
          refId: compositionEquipmentLines.equipmentId,
          qtyPerUnit: compositionEquipmentLines.qtyPerUnit,
          name: equipment.name,
          unitCost: equipment.hourlyCost,
        })
        .from(compositionEquipmentLines)
        .innerJoin(equipment, eq(compositionEquipmentLines.equipmentId, equipment.id))
        .where(eq(compositionEquipmentLines.compositionId, id)),
      computeCompositionUnitCost(id),
    ]);

    return { ...composition, labourLines, materialLines, equipmentLines, ...breakdown };
  });

  app.post("/api/catalog/compositions", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = costCompositionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourLines, materialLines, equipmentLines, ...data } = parsed.data;
    const companyId = targetCompanyId(request);

    const [composition] = await db.insert(costCompositions).values({ ...data, companyId }).returning();

    if (labourLines.length) {
      await db.insert(compositionLabourLines).values(
        labourLines.map((l) => ({
          compositionId: composition.id,
          labourCategoryId: l.refId,
          qtyPerUnit: l.qtyPerUnit.toString(),
        }))
      );
    }
    if (materialLines.length) {
      await db.insert(compositionMaterialLines).values(
        materialLines.map((l) => ({
          compositionId: composition.id,
          materialId: l.refId,
          qtyPerUnit: l.qtyPerUnit.toString(),
        }))
      );
    }
    if (equipmentLines.length) {
      await db.insert(compositionEquipmentLines).values(
        equipmentLines.map((l) => ({
          compositionId: composition.id,
          equipmentId: l.refId,
          qtyPerUnit: l.qtyPerUnit.toString(),
        }))
      );
    }

    const breakdown = await computeCompositionUnitCost(composition.id);
    return reply.code(201).send({ ...composition, ...breakdown });
  });

  // Actualiza a composição (nome/categoria/unidade + rendimentos). Se a composição pertencer
  // ao catálogo partilhado, clona-a silenciosamente para a empresa antes de aplicar a edição
  // — a empresa nunca precisa de um passo explícito de "clonar" para ajustar variáveis.
  app.put("/api/catalog/compositions/:id", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const companyId = targetCompanyId(request);

    let [target] = await db
      .select()
      .from(costCompositions)
      .where(and(eq(costCompositions.id, id), companyId ? eq(costCompositions.companyId, companyId) : isNull(costCompositions.companyId)))
      .limit(1);

    if (!target && companyId) {
      const cloned = await cloneCompositionForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Composição não encontrada" });
      target = cloned;
    }
    if (!target) return reply.code(404).send({ error: "Composição não encontrada" });

    const parsed = costCompositionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourLines, materialLines, equipmentLines, ...data } = parsed.data;
    const targetId = target.id;

    await db.update(costCompositions).set(data).where(eq(costCompositions.id, targetId));
    await db.delete(compositionLabourLines).where(eq(compositionLabourLines.compositionId, targetId));
    await db.delete(compositionMaterialLines).where(eq(compositionMaterialLines.compositionId, targetId));
    await db.delete(compositionEquipmentLines).where(eq(compositionEquipmentLines.compositionId, targetId));

    if (labourLines.length) {
      await db.insert(compositionLabourLines).values(
        labourLines.map((l) => ({ compositionId: targetId, labourCategoryId: l.refId, qtyPerUnit: l.qtyPerUnit.toString() }))
      );
    }
    if (materialLines.length) {
      await db.insert(compositionMaterialLines).values(
        materialLines.map((l) => ({ compositionId: targetId, materialId: l.refId, qtyPerUnit: l.qtyPerUnit.toString() }))
      );
    }
    if (equipmentLines.length) {
      await db.insert(compositionEquipmentLines).values(
        equipmentLines.map((l) => ({ compositionId: targetId, equipmentId: l.refId, qtyPerUnit: l.qtyPerUnit.toString() }))
      );
    }

    const breakdown = await computeCompositionUnitCost(targetId);
    const [updated] = await db.select().from(costCompositions).where(eq(costCompositions.id, targetId)).limit(1);
    return { ...updated, ...breakdown };
  });

  app.delete("/api/catalog/compositions/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = targetCompanyId(request);
    await db
      .delete(costCompositions)
      .where(and(eq(costCompositions.id, id), companyId ? eq(costCompositions.companyId, companyId) : isNull(costCompositions.companyId)));
    return { ok: true };
  });
}
