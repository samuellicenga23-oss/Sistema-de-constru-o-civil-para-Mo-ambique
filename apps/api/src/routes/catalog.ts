import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, or, isNull, and, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import {
  labourCategories,
  materials,
  equipment,
  companies,
  materialZonePrices,
  suppliers,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
  priceZones,
} from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { computeHourlyRate } from "../services/costEngine.js";
import { cloneLabourCategoryForCompany, cloneMaterialForCompany, cloneEquipmentForCompany } from "../services/catalogClone.js";
import { CURRENCIES, UNITS } from "@sigo/shared";

const CATALOG_ROLES = ["super_admin", "admin_empresa", "orcamentista"] as const;

function scopeFilter(companyIdColumn: AnyPgColumn, request: FastifyRequest): SQL | undefined {
  const { role, companyId } = request.currentUser!;
  if (role === "super_admin") return isNull(companyIdColumn);
  return or(isNull(companyIdColumn), eq(companyIdColumn, companyId!));
}

// Uma linha é "própria" se pertence à empresa (ou, para super_admin, se for global).
function ownScopeFilter(companyIdColumn: AnyPgColumn, request: FastifyRequest): SQL {
  const companyId = targetCompanyId(request);
  return companyId ? eq(companyIdColumn, companyId) : isNull(companyIdColumn);
}

function targetCompanyId(request: FastifyRequest): string | null {
  const { role, companyId } = request.currentUser!;
  return role === "super_admin" ? null : companyId!;
}

// Uma empresa só tem UMA linha visível por nome: a sua própria, se existir, senão a
// partilhada. Assim que a empresa edita um preço partilhado (clonagem automática), o
// duplicado global deixa de aparecer na lista — não há "dois Serventes" na mesma lista.
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

const labourCategorySchema = z.object({
  name: z.string().min(1),
  monthlySalary: z.number().positive(),
  currency: z.enum(CURRENCIES).default("MZN"),
});
const labourCategoryUpdateSchema = labourCategorySchema.partial();

const materialSchema = z.object({
  name: z.string().min(1),
  unit: z.enum(UNITS),
  baseUnitCost: z.number().nonnegative(),
  importFactor: z.number().positive().default(1),
  currency: z.enum(CURRENCIES).default("MZN"),
  // Unidade de compra de mercado (ex: "Camião 10m³", "Saco 20kg") — null/omitido = sem
  // conversão, mostra-se apenas na unidade de medida (ex: água, local; materiais ao peso solto).
  purchasePackageLabel: z.string().min(1).nullable().optional(),
  purchasePackageQty: z.number().positive().nullable().optional(),
});
const materialUpdateSchema = materialSchema.partial();

const equipmentSchema = z.object({
  name: z.string().min(1),
  unit: z.enum(UNITS),
  hourlyCost: z.number().nonnegative(),
  currency: z.enum(CURRENCIES).default("MZN"),
});
const equipmentUpdateSchema = equipmentSchema.partial();

async function getCompanyWorkingParams(companyId: string | null) {
  if (!companyId) return { workingDaysPerMonth: 22, workingHoursPerDay: 8 };
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  return {
    workingDaysPerMonth: company?.workingDaysPerMonth ?? 22,
    workingHoursPerDay: Number(company?.workingHoursPerDay ?? 8),
  };
}

export async function catalogRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRole(...CATALOG_ROLES) };

  // ---------- Mão-de-obra ----------
  app.get("/api/catalog/labour-categories", auth, async (request: FastifyRequest) => {
    const rows = await db.select().from(labourCategories).where(scopeFilter(labourCategories.companyId, request));
    return dedupeByName(rows).sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post("/api/catalog/labour-categories", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = labourCategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = targetCompanyId(request);
    const { workingDaysPerMonth, workingHoursPerDay } = await getCompanyWorkingParams(companyId);
    const hourlyRate = computeHourlyRate(parsed.data.monthlySalary, workingDaysPerMonth, workingHoursPerDay);

    const [row] = await db
      .insert(labourCategories)
      .values({
        ...parsed.data,
        companyId,
        monthlySalary: parsed.data.monthlySalary.toString(),
        hourlyRate: hourlyRate.toString(),
      })
      .returning();
    return reply.code(201).send(row);
  });

  // Edita uma categoria de mão-de-obra. Se pertencer ao catálogo partilhado, clona-a
  // silenciosamente para a empresa antes de aplicar a alteração (edição sempre directa).
  app.put("/api/catalog/labour-categories/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = labourCategoryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = targetCompanyId(request);
    let [target] = await db
      .select()
      .from(labourCategories)
      .where(and(eq(labourCategories.id, id), ownScopeFilter(labourCategories.companyId, request)))
      .limit(1);

    if (!target && companyId) {
      const cloned = await cloneLabourCategoryForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Categoria não encontrada" });
      target = cloned;
    }
    if (!target) return reply.code(404).send({ error: "Categoria não encontrada" });

    const monthlySalary = parsed.data.monthlySalary ?? Number(target.monthlySalary);
    let hourlyRate = Number(target.hourlyRate);
    if (parsed.data.monthlySalary !== undefined) {
      const { workingDaysPerMonth, workingHoursPerDay } = await getCompanyWorkingParams(target.companyId);
      hourlyRate = computeHourlyRate(monthlySalary, workingDaysPerMonth, workingHoursPerDay);
    }

    const [row] = await db
      .update(labourCategories)
      .set({ ...parsed.data, monthlySalary: monthlySalary.toString(), hourlyRate: hourlyRate.toString() })
      .where(eq(labourCategories.id, target.id))
      .returning();
    return row;
  });

  app.delete("/api/catalog/labour-categories/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(labourCategories).where(and(eq(labourCategories.id, id), ownScopeFilter(labourCategories.companyId, request)));
    return { ok: true };
  });

  // Lado inverso de GET /api/suppliers/:id/labour — que fornecedores disponibilizam esta
  // categoria de mão-de-obra subcontratada e a que preço/hora.
  app.get("/api/catalog/labour-categories/:id/suppliers", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [category] = await db.select().from(labourCategories).where(and(eq(labourCategories.id, id), scopeFilter(labourCategories.companyId, request))).limit(1);
    if (!category) return reply.code(404).send({ error: "Categoria não encontrada" });

    const { companyId } = request.currentUser!;
    const rows = await db
      .select({ price: supplierLabourPrices, supplierName: suppliers.name, zoneName: priceZones.name })
      .from(supplierLabourPrices)
      .innerJoin(suppliers, eq(supplierLabourPrices.supplierId, suppliers.id))
      .leftJoin(priceZones, eq(supplierLabourPrices.zoneId, priceZones.id))
      .where(and(eq(supplierLabourPrices.labourCategoryId, id), eq(suppliers.companyId, companyId!)));

    return rows.map((r) => ({ ...r.price, supplierName: r.supplierName, zoneName: r.zoneName }));
  });

  // ---------- Materiais ----------
  // `zoneId` (opcional): junta a cada material o seu preço nessa zona (`zonePrice`), quando
  // existir uma linha gravada para esse par (material, zona) — para a página do catálogo poder
  // mostrar/editar directamente "quanto custa cada material nesta zona", sem ter de abrir cada
  // material um a um.
  app.get("/api/catalog/materials", auth, async (request: FastifyRequest) => {
    const { zoneId } = request.query as { zoneId?: string };
    const rows = await db.select().from(materials).where(scopeFilter(materials.companyId, request));
    const deduped = dedupeByName(rows).sort((a, b) => a.name.localeCompare(b.name));

    if (!zoneId) return deduped;
    const materialIds = deduped.map((m) => m.id);
    const zonePrices = materialIds.length
      ? await db.select().from(materialZonePrices).where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, materialIds)))
      : [];
    const zonePriceByMaterialId = new Map(zonePrices.map((p) => [p.materialId, p.unitCost]));
    return deduped.map((m) => ({ ...m, zonePrice: zonePriceByMaterialId.get(m.id) ?? null }));
  });

  app.post("/api/catalog/materials", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = materialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = targetCompanyId(request);
    const [row] = await db
      .insert(materials)
      .values({
        ...parsed.data,
        companyId,
        baseUnitCost: parsed.data.baseUnitCost.toString(),
        importFactor: parsed.data.importFactor.toString(),
        purchasePackageQty: parsed.data.purchasePackageQty != null ? parsed.data.purchasePackageQty.toString() : null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/catalog/materials/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = materialUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = targetCompanyId(request);
    let [target] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.id, id), ownScopeFilter(materials.companyId, request)))
      .limit(1);

    if (!target && companyId) {
      const cloned = await cloneMaterialForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Material não encontrado" });
      target = cloned;
    }
    if (!target) return reply.code(404).send({ error: "Material não encontrado" });

    const [row] = await db
      .update(materials)
      .set({
        ...parsed.data,
        baseUnitCost: parsed.data.baseUnitCost !== undefined ? parsed.data.baseUnitCost.toString() : undefined,
        importFactor: parsed.data.importFactor !== undefined ? parsed.data.importFactor.toString() : undefined,
        purchasePackageQty: parsed.data.purchasePackageQty !== undefined ? (parsed.data.purchasePackageQty != null ? parsed.data.purchasePackageQty.toString() : null) : undefined,
      })
      .where(eq(materials.id, target.id))
      .returning();
    return row;
  });

  app.delete("/api/catalog/materials/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(materials).where(and(eq(materials.id, id), ownScopeFilter(materials.companyId, request)));
    return { ok: true };
  });

  // Lado inverso de GET /api/suppliers/:id/materials — que fornecedores vendem este material e a
  // que preço, para a página do Catálogo poder mostrar isso directamente em cada material.
  app.get("/api/catalog/materials/:id/suppliers", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [material] = await db.select().from(materials).where(and(eq(materials.id, id), scopeFilter(materials.companyId, request))).limit(1);
    if (!material) return reply.code(404).send({ error: "Material não encontrado" });

    const { companyId } = request.currentUser!;
    const rows = await db
      .select({ price: supplierMaterialPrices, supplierName: suppliers.name, zoneName: priceZones.name })
      .from(supplierMaterialPrices)
      .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
      .leftJoin(priceZones, eq(supplierMaterialPrices.zoneId, priceZones.id))
      .where(and(eq(supplierMaterialPrices.materialId, id), eq(suppliers.companyId, companyId!)));

    return rows.map((r) => ({ ...r.price, supplierName: r.supplierName, zoneName: r.zoneName }));
  });

  // ---------- Máquinas/Equipamento ----------
  app.get("/api/catalog/equipment", auth, async (request: FastifyRequest) => {
    const rows = await db.select().from(equipment).where(scopeFilter(equipment.companyId, request));
    return dedupeByName(rows).sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post("/api/catalog/equipment", auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = equipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = targetCompanyId(request);
    const [row] = await db
      .insert(equipment)
      .values({ ...parsed.data, companyId, hourlyCost: parsed.data.hourlyCost.toString() })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/catalog/equipment/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = equipmentUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = targetCompanyId(request);
    let [target] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, id), ownScopeFilter(equipment.companyId, request)))
      .limit(1);

    if (!target && companyId) {
      const cloned = await cloneEquipmentForCompany(id, companyId);
      if (!cloned) return reply.code(404).send({ error: "Equipamento não encontrado" });
      target = cloned;
    }
    if (!target) return reply.code(404).send({ error: "Equipamento não encontrado" });

    const [row] = await db
      .update(equipment)
      .set({ ...parsed.data, hourlyCost: parsed.data.hourlyCost !== undefined ? parsed.data.hourlyCost.toString() : undefined })
      .where(eq(equipment.id, target.id))
      .returning();
    return row;
  });

  app.delete("/api/catalog/equipment/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(equipment).where(and(eq(equipment.id, id), ownScopeFilter(equipment.companyId, request)));
    return { ok: true };
  });

  // Lado inverso de GET /api/suppliers/:id/equipment — que fornecedores alugam este
  // equipamento e a que preço/hora.
  app.get("/api/catalog/equipment/:id/suppliers", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [equip] = await db.select().from(equipment).where(and(eq(equipment.id, id), scopeFilter(equipment.companyId, request))).limit(1);
    if (!equip) return reply.code(404).send({ error: "Equipamento não encontrado" });

    const { companyId } = request.currentUser!;
    const rows = await db
      .select({ price: supplierEquipmentPrices, supplierName: suppliers.name, zoneName: priceZones.name })
      .from(supplierEquipmentPrices)
      .innerJoin(suppliers, eq(supplierEquipmentPrices.supplierId, suppliers.id))
      .leftJoin(priceZones, eq(supplierEquipmentPrices.zoneId, priceZones.id))
      .where(and(eq(supplierEquipmentPrices.equipmentId, id), eq(suppliers.companyId, companyId!)));

    return rows.map((r) => ({ ...r.price, supplierName: r.supplierName, zoneName: r.zoneName }));
  });
}
