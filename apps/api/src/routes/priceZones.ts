import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, or, isNull, and, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import { priceZones, materials, materialZonePrices } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { cloneMaterialForCompany } from "../services/catalogClone.js";

const CATALOG_ROLES = ["super_admin", "admin_empresa", "orcamentista"] as const;

function scopeFilter(companyIdColumn: AnyPgColumn, request: FastifyRequest): SQL | undefined {
  const { role, companyId } = request.currentUser!;
  if (role === "super_admin") return isNull(companyIdColumn);
  return or(isNull(companyIdColumn), eq(companyIdColumn, companyId!));
}

function ownScopeFilter(companyIdColumn: AnyPgColumn, request: FastifyRequest): SQL {
  const companyId = targetCompanyId(request);
  return companyId ? eq(companyIdColumn, companyId) : isNull(companyIdColumn);
}

function targetCompanyId(request: FastifyRequest): string | null {
  const { role, companyId } = request.currentUser!;
  return role === "super_admin" ? null : companyId!;
}

const zoneSchema = z.object({
  name: z.string().trim().min(1).max(100),
  province: z.string().trim().max(100).nullable().optional(),
  district: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  materialAdjustmentPct: z.number().min(-100).max(500).default(0),
  labourAdjustmentPct: z.number().min(-100).max(500).default(0),
  equipmentAdjustmentPct: z.number().min(-100).max(500).default(0),
  defaultTransportPct: z.number().min(0).max(500).default(0),
  sourceName: z.string().trim().max(180).nullable().optional(),
  sourceReference: z.string().trim().max(2000).nullable().optional(),
  effectiveDate: z.string().date().nullable().optional(),
});
const zonePriceSchema = z.object({
  unitCost: z.number().nonnegative(),
  sourceName: z.string().trim().max(180).nullable().optional(),
  sourceReference: z.string().trim().max(2000).nullable().optional(),
  effectiveDate: z.string().date().nullable().optional(),
  includesVat: z.boolean().default(false),
  transportIncluded: z.boolean().default(true),
});

function serializeZoneInput(data: z.infer<typeof zoneSchema>) {
  return {
    ...data,
    materialAdjustmentPct: data.materialAdjustmentPct.toString(),
    labourAdjustmentPct: data.labourAdjustmentPct.toString(),
    equipmentAdjustmentPct: data.equipmentAdjustmentPct.toString(),
    defaultTransportPct: data.defaultTransportPct.toString(),
  };
}

export async function priceZoneRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRole(...CATALOG_ROLES) };

  // Sem sessão nenhuma — precisa de existir antes de o fornecedor ter conta, para escolher a
  // zona onde opera no formulário público de registo (apps/supplier).
  app.get("/api/public/price-zones", async () => {
    const rows = await db.select({ id: priceZones.id, name: priceZones.name, province: priceZones.province }).from(priceZones).where(isNull(priceZones.companyId));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
  // Zonas passaram a ser uma lista única e nacional, gerida só pela plataforma — é o fornecedor
  // que, ao registar-se no SIGO Fornecedores, indica em qual delas opera (ver
  // routes/supplierAuth.ts). A empresa deixou de poder criar/editar/eliminar zonas próprias;
  // continua livre para indicar o preço dos SEUS materiais em cada zona existente (ver as rotas
  // de "Preços de material por zona" abaixo, essas continuam abertas a CATALOG_ROLES).
  const zoneManageAuth = { preHandler: requireRole("super_admin") };

  // ---------- Zonas de preço (lista nacional única, só de leitura para empresas) ----------
  app.get("/api/catalog/price-zones", auth, async () => {
    const rows = await db.select().from(priceZones).where(isNull(priceZones.companyId));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post("/api/catalog/price-zones", zoneManageAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = zoneSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.insert(priceZones).values({ ...serializeZoneInput(parsed.data), companyId: null }).returning();
    return reply.code(201).send(row);
  });

  app.put("/api/catalog/price-zones/:id", zoneManageAuth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = zoneSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [target] = await db.select().from(priceZones).where(and(eq(priceZones.id, id), isNull(priceZones.companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Zona não encontrada" });

    const update = parsed.data;
    const [row] = await db.update(priceZones).set({
      ...update,
      materialAdjustmentPct: update.materialAdjustmentPct?.toString(),
      labourAdjustmentPct: update.labourAdjustmentPct?.toString(),
      equipmentAdjustmentPct: update.equipmentAdjustmentPct?.toString(),
      defaultTransportPct: update.defaultTransportPct?.toString(),
      updatedAt: new Date(),
    }).where(eq(priceZones.id, target.id)).returning();
    return row;
  });

  app.delete("/api/catalog/price-zones/:id", zoneManageAuth, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(priceZones).where(and(eq(priceZones.id, id), isNull(priceZones.companyId)));
    return { ok: true };
  });

  // ---------- Preços de material por zona ----------
  // Um material só pode ter preços por zona depois de pertencer à empresa (clonagem
  // automática do catálogo partilhado, mesmo princípio já usado nas restantes edições).
  app.get("/api/catalog/materials/:id/zone-prices", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [material] = await db.select().from(materials).where(and(eq(materials.id, id), scopeFilter(materials.companyId, request))).limit(1);
    if (!material) return reply.code(404).send({ error: "Material não encontrado" });
    // O material pode ser global, mas a zona é sempre uma fronteira de empresa. Não revelar
    // preços/cotações de zonas privadas que pertencem a outra empresa.
    return db
      .select({ price: materialZonePrices })
      .from(materialZonePrices)
      .innerJoin(priceZones, eq(materialZonePrices.zoneId, priceZones.id))
      .where(and(eq(materialZonePrices.materialId, id), scopeFilter(priceZones.companyId, request)))
      .then((rows) => rows.map(({ price }) => price));
  });

  app.put("/api/catalog/materials/:id/zone-prices/:zoneId", auth, async (request, reply) => {
    const { id, zoneId } = request.params as { id: string; zoneId: string };
    const parsed = zonePriceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = targetCompanyId(request);
    let [material] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.id, id), ownScopeFilter(materials.companyId, request)))
      .limit(1);
    if (!material && companyId) {
      const cloned = await cloneMaterialForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Material não encontrado" });
      material = cloned;
    }
    if (!material) return reply.code(404).send({ error: "Material não encontrado" });

    const [zone] = await db.select().from(priceZones).where(and(eq(priceZones.id, zoneId), scopeFilter(priceZones.companyId, request))).limit(1);
    if (!zone) return reply.code(404).send({ error: "Zona não encontrada" });

    const [existing] = await db
      .select()
      .from(materialZonePrices)
      .where(and(eq(materialZonePrices.materialId, material.id), eq(materialZonePrices.zoneId, zoneId)))
      .limit(1);

    const { unitCost: numericUnitCost, ...metadata } = parsed.data;
    const unitCost = numericUnitCost.toString();
    if (existing) {
      const [row] = await db.update(materialZonePrices).set({ unitCost, ...metadata, updatedAt: new Date() }).where(eq(materialZonePrices.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(materialZonePrices).values({ materialId: material.id, zoneId, unitCost, ...metadata }).returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/catalog/materials/:id/zone-prices/:zoneId", auth, async (request, reply) => {
    const { id, zoneId } = request.params as { id: string; zoneId: string };
    const companyId = targetCompanyId(request);
    const [material] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.id, id), ownScopeFilter(materials.companyId, request)))
      .limit(1);
    // Sem material próprio, não pode haver preço de zona gravado por esta empresa para ele.
    if (!material || !companyId) return { ok: true };
    await db.delete(materialZonePrices).where(and(eq(materialZonePrices.materialId, material.id), eq(materialZonePrices.zoneId, zoneId)));
    return { ok: true };
  });
}
