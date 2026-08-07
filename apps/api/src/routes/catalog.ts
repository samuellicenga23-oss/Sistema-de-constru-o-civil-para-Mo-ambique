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
import { SIGO_PRICES_SUPPLIER_NAME, syncSigoPricesForCompany } from "../services/sigoPrices.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { CURRENCIES, UNITS, fixedSigo } from "@sigo/shared";

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
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().min(1),
  monthlySalary: z.number().positive(),
  productiveHoursPerMonth: z.number().positive().nullable().optional(),
  socialChargesPct: z.number().min(0).max(200).default(0),
  complementaryCostsPct: z.number().min(0).max(200).default(0),
  currency: z.enum(CURRENCIES).default("MZN"),
  sourceName: z.string().trim().max(180).nullable().optional(),
  sourceReference: z.string().trim().max(2000).nullable().optional(),
  effectiveDate: z.string().date().nullable().optional(),
  isActive: z.boolean().default(true),
});
const labourCategoryUpdateSchema = labourCategorySchema.partial();

const materialSchema = z.object({
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().min(1),
  category: z.string().trim().min(1).max(100).default("Outros"),
  specification: z.string().trim().max(2000).nullable().optional(),
  unit: z.enum(UNITS),
  baseUnitCost: z.number().nonnegative(),
  importFactor: z.number().positive().default(1),
  defaultWastePct: z.number().min(0).max(100).default(0),
  currency: z.enum(CURRENCIES).default("MZN"),
  priceSourceName: z.string().trim().max(180).nullable().optional(),
  sourceReference: z.string().trim().max(2000).nullable().optional(),
  priceDate: z.string().date().nullable().optional(),
  includesVat: z.boolean().default(false),
  isActive: z.boolean().default(true),
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
    const hourlyRate = computeHourlyRate(
      parsed.data.monthlySalary,
      workingDaysPerMonth,
      workingHoursPerDay,
      parsed.data.productiveHoursPerMonth,
      parsed.data.socialChargesPct,
      parsed.data.complementaryCostsPct
    );

    const [row] = await db
      .insert(labourCategories)
      .values({
        ...parsed.data,
        companyId,
        monthlySalary: parsed.data.monthlySalary.toString(),
        productiveHoursPerMonth: parsed.data.productiveHoursPerMonth?.toString() ?? null,
        socialChargesPct: parsed.data.socialChargesPct.toString(),
        complementaryCostsPct: parsed.data.complementaryCostsPct.toString(),
        hourlyRate: fixedSigo(hourlyRate),
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
    if (
      parsed.data.monthlySalary !== undefined
      || parsed.data.productiveHoursPerMonth !== undefined
      || parsed.data.socialChargesPct !== undefined
      || parsed.data.complementaryCostsPct !== undefined
    ) {
      const { workingDaysPerMonth, workingHoursPerDay } = await getCompanyWorkingParams(target.companyId);
      hourlyRate = computeHourlyRate(
        monthlySalary,
        workingDaysPerMonth,
        workingHoursPerDay,
        parsed.data.productiveHoursPerMonth === undefined ? Number(target.productiveHoursPerMonth) || null : parsed.data.productiveHoursPerMonth,
        parsed.data.socialChargesPct ?? Number(target.socialChargesPct),
        parsed.data.complementaryCostsPct ?? Number(target.complementaryCostsPct)
      );
    }

    const [row] = await db
      .update(labourCategories)
      .set({
        ...parsed.data,
        monthlySalary: monthlySalary.toString(),
        productiveHoursPerMonth: parsed.data.productiveHoursPerMonth === undefined
          ? undefined
          : parsed.data.productiveHoursPerMonth?.toString() ?? null,
        socialChargesPct: parsed.data.socialChargesPct?.toString(),
        complementaryCostsPct: parsed.data.complementaryCostsPct?.toString(),
        hourlyRate: fixedSigo(hourlyRate),
        updatedAt: new Date(),
      })
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

    const materialIds = deduped.map((m) => m.id);
    const [selectedZone] = zoneId
      ? await db.select().from(priceZones).where(and(eq(priceZones.id, zoneId), scopeFilter(priceZones.companyId, request))).limit(1)
      : [undefined];
    // Não consultar preços de uma zona antes de confirmar que a zona é visível à empresa.
    // Um UUID de zona privada não pode alterar nem revelar a resposta do catálogo alheio.
    const zonePrices = selectedZone && materialIds.length
      ? await db.select().from(materialZonePrices).where(and(eq(materialZonePrices.zoneId, selectedZone.id), inArray(materialZonePrices.materialId, materialIds)))
      : [];
    const zonePriceByMaterialId = new Map(zonePrices.map((p) => [p.materialId, p]));
    const zoneFallbackFactor = selectedZone
      ? (1 + Number(selectedZone.materialAdjustmentPct) / 100) * (1 + Number(selectedZone.defaultTransportPct) / 100)
      : 1;

    // Liga o mercado real ao catálogo: para cada material mostra a melhor cotação de fornecedor
    // compatível com a zona seleccionada. Uma cotação específica da zona tem prioridade sobre uma
    // cotação geral; dentro do mesmo nível escolhe-se a de menor preço. É uma sugestão explícita —
    // nunca altera silenciosamente o preço usado nas composições/orçamentos.
    const companyId = request.currentUser!.companyId;
    // Preços próprios (SIGO Preços) sempre entram; preços do marketplace nacional (fornecedores
    // reais, companyId null) só entram para empresas do plano Profissional — mesmo gate aplicado
    // em GET /api/marketplace/suppliers. Um fornecedor do marketplace não tem cotação "por zona"
    // (supplierMaterialPrices.zoneId fica sempre null nesses casos) — a zona é a que ele indicou
    // no registo (suppliers.zoneId), por isso a correspondência de zona usa uma coluna diferente
    // consoante o tipo de fornecedor.
    const marketplaceAllowed = companyId ? !(await assertSupplierMarketplaceAccess(companyId)) : false;
    const quoteRows = companyId && materialIds.length
      ? await db
          .select({
            materialId: supplierMaterialPrices.materialId,
            unitCost: supplierMaterialPrices.unitCost,
            currency: supplierMaterialPrices.currency,
            zoneId: supplierMaterialPrices.zoneId,
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            supplierCompanyId: suppliers.companyId,
            supplierZoneId: suppliers.zoneId,
          })
          .from(supplierMaterialPrices)
          .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
          .where(and(
            marketplaceAllowed ? or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId)) : eq(suppliers.companyId, companyId),
            inArray(supplierMaterialPrices.materialId, materialIds),
          ))
      : [];
    const bestQuoteByMaterialId = new Map<string, (typeof quoteRows)[number] & { zoneMatch: boolean }>();
    for (const quote of quoteRows) {
      const zoneMatch = quote.supplierCompanyId === null ? zoneId != null && quote.supplierZoneId === zoneId : zoneId != null && quote.zoneId === zoneId;
      // Cotações gerais (sem zona própria) só contam quando não há filtro de zona activo, ou
      // quando são do próprio catálogo (SIGO Preços) sem zona específica — um fornecedor privado
      // fora da zona pedida não deve aparecer como sugestão.
      if (quote.supplierCompanyId === null && zoneId != null && !zoneMatch) continue;
      if (quote.supplierCompanyId !== null && quote.zoneId != null && zoneId != null && !zoneMatch) continue;
      const current = bestQuoteByMaterialId.get(quote.materialId);
      if (
        !current ||
        (zoneMatch && !current.zoneMatch) ||
        (zoneMatch === current.zoneMatch && Number(quote.unitCost) < Number(current.unitCost))
      ) {
        bestQuoteByMaterialId.set(quote.materialId, { ...quote, zoneMatch });
      }
    }

    return deduped.map((m) => {
      const quote = bestQuoteByMaterialId.get(m.id);
      const explicitZonePrice = zonePriceByMaterialId.get(m.id);
      const effectiveBeforeImport = explicitZonePrice ? Number(explicitZonePrice.unitCost) : Number(m.baseUnitCost) * zoneFallbackFactor;
      const effectiveUnitCost = effectiveBeforeImport * Number(m.importFactor);
      return {
        ...m,
        zonePrice: explicitZonePrice?.unitCost ?? null,
        zonePriceSourceName: explicitZonePrice?.sourceName ?? null,
        zonePriceEffectiveDate: explicitZonePrice?.effectiveDate ?? null,
        effectiveUnitCost,
        priceBasis: explicitZonePrice ? "zone_specific" : selectedZone ? "zone_adjusted_base" : "base",
        marketPrice: quote?.unitCost ?? null,
        marketCurrency: quote?.currency ?? null,
        marketSupplierId: quote?.supplierId ?? null,
        marketSupplierName: quote?.supplierName ?? null,
        marketPriceIsReference: quote?.supplierName === SIGO_PRICES_SUPPLIER_NAME,
        marketPriceIsZoneSpecific: Boolean(quote?.zoneMatch),
      };
    });
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
        defaultWastePct: parsed.data.defaultWastePct.toString(),
        purchasePackageQty: parsed.data.purchasePackageQty != null ? parsed.data.purchasePackageQty.toString() : null,
      })
      .returning();
    if (companyId) await syncSigoPricesForCompany(companyId);
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
        defaultWastePct: parsed.data.defaultWastePct !== undefined ? parsed.data.defaultWastePct.toString() : undefined,
        purchasePackageQty: parsed.data.purchasePackageQty !== undefined ? (parsed.data.purchasePackageQty != null ? parsed.data.purchasePackageQty.toString() : null) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(materials.id, target.id))
      .returning();
    if (companyId) await syncSigoPricesForCompany(companyId);
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
