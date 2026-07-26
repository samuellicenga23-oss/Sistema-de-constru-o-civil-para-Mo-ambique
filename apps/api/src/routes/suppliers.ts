import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  suppliers,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
  materials,
  labourCategories,
  equipment,
  priceZones,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { CURRENCIES } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const supplierSchema = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
  location: z.string().optional(),
  nuit: z.string().optional(),
  notes: z.string().optional(),
});
const supplierUpdateSchema = supplierSchema.partial();

const materialPriceSchema = z.object({
  materialId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  unitCost: z.number().nonnegative(),
  currency: z.enum(CURRENCIES).default("MZN"),
});

const labourPriceSchema = z.object({
  labourCategoryId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  hourlyCost: z.number().nonnegative(),
  currency: z.enum(CURRENCIES).default("MZN"),
});

const equipmentPriceSchema = z.object({
  equipmentId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  hourlyCost: z.number().nonnegative(),
  currency: z.enum(CURRENCIES).default("MZN"),
});

async function assertSupplierOwned(supplierId: string, companyId: string) {
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId))).limit(1);
  return supplier ?? null;
}

export async function supplierRoutes(app: FastifyInstance) {
  app.get("/api/suppliers", { preHandler: requireCompanyUser }, async (request) => {
    return db.select().from(suppliers).where(eq(suppliers.companyId, companyIdOf(request))).orderBy(suppliers.name);
  });

  app.post("/api/suppliers", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const parsed = supplierSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(suppliers).values({ ...parsed.data, companyId: companyIdOf(request) }).returning();
    return reply.code(201).send(row);
  });

  app.put("/api/suppliers/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = supplierUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db
      .update(suppliers)
      .set(parsed.data)
      .where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyIdOf(request))))
      .returning();
    if (!row) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    return row;
  });

  app.delete("/api/suppliers/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyIdOf(request))));
    return { ok: true };
  });

  // ---------- Preços de materiais por fornecedor (e opcionalmente por zona) ----------
  // Isto é o que faz aparecer "materiais" dentro de um fornecedor — ver também
  // GET /api/catalog/materials/:id/suppliers em catalog.ts para o lado inverso (fornecedores
  // dentro de um material), sobre os mesmos dados.
  app.get("/api/suppliers/:id/materials", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const rows = await db
      .select({
        price: supplierMaterialPrices,
        materialName: materials.name,
        materialUnit: materials.unit,
        zoneName: priceZones.name,
      })
      .from(supplierMaterialPrices)
      .innerJoin(materials, eq(supplierMaterialPrices.materialId, materials.id))
      .leftJoin(priceZones, eq(supplierMaterialPrices.zoneId, priceZones.id))
      .where(eq(supplierMaterialPrices.supplierId, id));

    return rows.map((r) => ({ ...r.price, materialName: r.materialName, unit: r.materialUnit, zoneName: r.zoneName }));
  });

  app.put("/api/suppliers/:id/materials", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierOwned(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const parsed = materialPriceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { materialId, zoneId, unitCost, currency } = parsed.data;

    const [material] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), or(isNull(materials.companyId), eq(materials.companyId, companyId))))
      .limit(1);
    if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo" });

    const existing = await db
      .select()
      .from(supplierMaterialPrices)
      .where(
        and(
          eq(supplierMaterialPrices.supplierId, id),
          eq(supplierMaterialPrices.materialId, materialId),
          zoneId ? eq(supplierMaterialPrices.zoneId, zoneId) : isNull(supplierMaterialPrices.zoneId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(supplierMaterialPrices)
        .set({ unitCost: unitCost.toString(), currency })
        .where(eq(supplierMaterialPrices.id, existing[0].id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(supplierMaterialPrices)
      .values({ supplierId: id, materialId, zoneId: zoneId ?? null, unitCost: unitCost.toString(), currency })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/suppliers/:id/materials/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id, priceId } = request.params as { id: string; priceId: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierMaterialPrices).where(and(eq(supplierMaterialPrices.id, priceId), eq(supplierMaterialPrices.supplierId, id)));
    return { ok: true };
  });

  // ---------- Preços de mão-de-obra subcontratada por fornecedor ----------
  app.get("/api/suppliers/:id/labour", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const rows = await db
      .select({ price: supplierLabourPrices, labourName: labourCategories.name, zoneName: priceZones.name })
      .from(supplierLabourPrices)
      .innerJoin(labourCategories, eq(supplierLabourPrices.labourCategoryId, labourCategories.id))
      .leftJoin(priceZones, eq(supplierLabourPrices.zoneId, priceZones.id))
      .where(eq(supplierLabourPrices.supplierId, id));

    return rows.map((r) => ({ ...r.price, labourName: r.labourName, zoneName: r.zoneName }));
  });

  app.put("/api/suppliers/:id/labour", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierOwned(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const parsed = labourPriceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourCategoryId, zoneId, hourlyCost, currency } = parsed.data;

    const [category] = await db
      .select()
      .from(labourCategories)
      .where(and(eq(labourCategories.id, labourCategoryId), or(isNull(labourCategories.companyId), eq(labourCategories.companyId, companyId))))
      .limit(1);
    if (!category) return reply.code(404).send({ error: "Categoria de mão-de-obra não encontrada no Catálogo" });

    const existing = await db
      .select()
      .from(supplierLabourPrices)
      .where(
        and(
          eq(supplierLabourPrices.supplierId, id),
          eq(supplierLabourPrices.labourCategoryId, labourCategoryId),
          zoneId ? eq(supplierLabourPrices.zoneId, zoneId) : isNull(supplierLabourPrices.zoneId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(supplierLabourPrices)
        .set({ hourlyCost: hourlyCost.toString(), currency })
        .where(eq(supplierLabourPrices.id, existing[0].id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(supplierLabourPrices)
      .values({ supplierId: id, labourCategoryId, zoneId: zoneId ?? null, hourlyCost: hourlyCost.toString(), currency })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/suppliers/:id/labour/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id, priceId } = request.params as { id: string; priceId: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierLabourPrices).where(and(eq(supplierLabourPrices.id, priceId), eq(supplierLabourPrices.supplierId, id)));
    return { ok: true };
  });

  // ---------- Preços de máquinas/equipamento alugado por fornecedor ----------
  app.get("/api/suppliers/:id/equipment", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const rows = await db
      .select({ price: supplierEquipmentPrices, equipmentName: equipment.name, zoneName: priceZones.name })
      .from(supplierEquipmentPrices)
      .innerJoin(equipment, eq(supplierEquipmentPrices.equipmentId, equipment.id))
      .leftJoin(priceZones, eq(supplierEquipmentPrices.zoneId, priceZones.id))
      .where(eq(supplierEquipmentPrices.supplierId, id));

    return rows.map((r) => ({ ...r.price, equipmentName: r.equipmentName, zoneName: r.zoneName }));
  });

  app.put("/api/suppliers/:id/equipment", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierOwned(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const parsed = equipmentPriceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { equipmentId, zoneId, hourlyCost, currency } = parsed.data;

    const [equip] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), or(isNull(equipment.companyId), eq(equipment.companyId, companyId))))
      .limit(1);
    if (!equip) return reply.code(404).send({ error: "Equipamento não encontrado no Catálogo" });

    const existing = await db
      .select()
      .from(supplierEquipmentPrices)
      .where(
        and(
          eq(supplierEquipmentPrices.supplierId, id),
          eq(supplierEquipmentPrices.equipmentId, equipmentId),
          zoneId ? eq(supplierEquipmentPrices.zoneId, zoneId) : isNull(supplierEquipmentPrices.zoneId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(supplierEquipmentPrices)
        .set({ hourlyCost: hourlyCost.toString(), currency })
        .where(eq(supplierEquipmentPrices.id, existing[0].id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(supplierEquipmentPrices)
      .values({ supplierId: id, equipmentId, zoneId: zoneId ?? null, hourlyCost: hourlyCost.toString(), currency })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/suppliers/:id/equipment/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id, priceId } = request.params as { id: string; priceId: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierEquipmentPrices).where(and(eq(supplierEquipmentPrices.id, priceId), eq(supplierEquipmentPrices.supplierId, id)));
    return { ok: true };
  });
}
