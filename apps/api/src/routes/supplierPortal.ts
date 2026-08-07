import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  suppliers,
  companies,
  quoteRequests,
  quoteRequestLines,
  projects,
  users,
  priceZones,
  materials,
  labourCategories,
  equipment,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
  supplierAccounts,
} from "../db/schema.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { sendEmail, emailLayout, escapeHtml } from "../services/mailer.js";
import { listNotificationsForSupplierAccount, markAllNotificationsRead, markNotificationRead, notifyUsers } from "../services/notifications.js";
import { CURRENCIES } from "@sigo/shared";
import { env } from "../env.js";
import { ensureSigoMarketplaceSupplier, isSigoPricesAccount } from "../services/sigoPrices.js";
import { addCatalogItem, hasAnyOffer, selectedResourceIds, setSupplierOffers } from "../services/supplierOfferings.js";
import { resolveMaterialCategory } from "../services/materialCategories.js";

function supplierAccountIdOf(request: FastifyRequest): string {
  return request.currentSupplier!.id;
}

// Todas as fichas `suppliers` (uma por empresa) ligadas a esta conta global — é isto que faz o
// fornecedor ver, num só login, todas as empresas SIGO com quem trabalha.
async function ownedSupplierIds(supplierAccountId: string): Promise<string[]> {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, supplierAccountId));
  return rows.map((r) => r.id);
}

// A ÚNICA ficha global (companyId null) desta conta no marketplace nacional — onde o fornecedor
// gere os seus próprios preços de materiais/mão-de-obra/máquinas, vistos por todas as empresas.
async function ownGlobalSupplier(supplierAccountId: string) {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.supplierAccountId, supplierAccountId), isNull(suppliers.companyId)))
    .limit(1);
  return row ?? null;
}

/** Cria a ficha marketplace se a conta ainda só tiver fichas ligadas a empresas (ex.: Equipa SIGO Preços). */
async function ensureOwnMarketplaceSupplier(supplierAccountId: string) {
  const existing = await ownGlobalSupplier(supplierAccountId);
  if (existing) return existing;

  const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.id, supplierAccountId)).limit(1);
  if (!account) return null;

  if (isSigoPricesAccount(account)) {
    return ensureSigoMarketplaceSupplier();
  }

  const [zone] = await db.select().from(priceZones).where(isNull(priceZones.companyId)).orderBy(priceZones.name).limit(1);

  const [row] = await db
    .insert(suppliers)
    .values({
      companyId: null,
      name: account.name,
      contact: account.phone,
      supplierAccountId,
      zoneId: zone?.id ?? null,
      location: zone?.name ?? "Moçambique",
      notes: null,
    })
    .returning();
  return row;
}

/** Materiais seleccionados na oferta (e pedidos de cotação a esta conta). */
async function marketplaceMaterialCatalog(supplierAccountId: string, marketplaceSupplierId: string) {
  const selectedIds = await selectedResourceIds(marketplaceSupplierId, "material");

  const owned = await ownedSupplierIds(supplierAccountId);
  let rfqIds: string[] = [];
  if (owned.length) {
    const rows = await db
      .selectDistinct({ materialId: quoteRequestLines.materialId })
      .from(quoteRequestLines)
      .innerJoin(quoteRequests, eq(quoteRequestLines.quoteRequestId, quoteRequests.id))
      .where(and(inArray(quoteRequests.supplierId, owned), eq(quoteRequestLines.kind, "material")));
    rfqIds = rows.map((r) => r.materialId).filter((id): id is string => Boolean(id));
    // Pedidos novos entraram: passam a fazer parte da oferta deste fornecedor.
    for (const id of rfqIds) {
      if (!selectedIds.includes(id)) await addCatalogItem(marketplaceSupplierId, "material", id);
    }
  }

  const ids = [...new Set([...selectedIds, ...rfqIds])];
  if (!ids.length) return [];

  const rows = await db
    .select({
      id: materials.id,
      name: materials.name,
      unit: materials.unit,
      specification: materials.specification,
      category: materials.category,
      companyId: materials.companyId,
    })
    .from(materials)
    .where(and(inArray(materials.id, ids), eq(materials.isActive, true)))
    .orderBy(materials.category, materials.name);

  const selectedSet = new Set(selectedIds);
  return rows.map((m) => ({
    ...m,
    source: selectedSet.has(m.id) && !m.companyId ? ("nacional" as const) : m.companyId ? ("pedido" as const) : ("nacional" as const),
  }));
}

async function materialAllowedForMarketplace(supplierAccountId: string, marketplaceSupplierId: string, materialId: string): Promise<boolean> {
  const selected = await selectedResourceIds(marketplaceSupplierId, "material");
  if (selected.includes(materialId)) return true;

  const owned = await ownedSupplierIds(supplierAccountId);
  if (!owned.length) return false;
  const [rfq] = await db
    .select({ id: quoteRequestLines.id })
    .from(quoteRequestLines)
    .innerJoin(quoteRequests, eq(quoteRequestLines.quoteRequestId, quoteRequests.id))
    .where(
      and(
        inArray(quoteRequests.supplierId, owned),
        eq(quoteRequestLines.kind, "material"),
        eq(quoteRequestLines.materialId, materialId),
      ),
    )
    .limit(1);
  return Boolean(rfq);
}

export async function supplierPortalRoutes(app: FastifyInstance) {
  // ---------- Sino de notificações ----------
  app.get("/api/supplier/notifications", { preHandler: requireSupplierAuth }, async (request) => {
    return listNotificationsForSupplierAccount(supplierAccountIdOf(request));
  });

  app.post("/api/supplier/notifications/:id/read", { preHandler: requireSupplierAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await markNotificationRead(id, { supplierAccountId: supplierAccountIdOf(request) });
    return { ok: true };
  });

  app.post("/api/supplier/notifications/read-all", { preHandler: requireSupplierAuth }, async (request) => {
    await markAllNotificationsRead({ supplierAccountId: supplierAccountIdOf(request) });
    return { ok: true };
  });

  // Empresas com quem este fornecedor está ligado — usado no ecrã inicial do portal. Para a
  // ficha SIGO Preços (companyId preenchido) é a própria empresa; para um fornecedor do
  // marketplace (companyId null) não há esse vínculo directo — a ligação real é "quem já lhe
  // pediu uma cotação", por isso deriva-se de quote_requests em vez de suppliers.companyId.
  app.get("/api/supplier/companies", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    if (!supplierIds.length) return [];
    const rows = await db
      .selectDistinct({ companyId: companies.id, companyName: companies.name, brandName: companies.brandName })
      .from(quoteRequests)
      .innerJoin(companies, eq(quoteRequests.companyId, companies.id))
      .where(inArray(quoteRequests.supplierId, supplierIds));
    return rows.map((r) => ({ companyId: r.companyId, companyName: r.brandName || r.companyName }));
  });

  // Contacto de quem pediu — nome e email de quem criou o pedido, e telefone da empresa (perfil).
  // Mostrado ao fornecedor exactamente para poder ligar directamente e ajudar a fechar a venda,
  // em vez de só saber "uma empresa qualquer pediu um preço".
  app.get("/api/supplier/quote-requests", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    if (!supplierIds.length) return [];
    const rows = await db
      .select({ quoteRequest: quoteRequests, companyName: companies.name, brandName: companies.brandName, companyPhone: companies.phone, projectName: projects.name, buyerName: users.name, buyerEmail: users.email })
      .from(quoteRequests)
      .innerJoin(companies, eq(quoteRequests.companyId, companies.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .leftJoin(users, eq(quoteRequests.createdByUserId, users.id))
      .where(inArray(quoteRequests.supplierId, supplierIds))
      .orderBy(desc(quoteRequests.createdAt));
    return rows.map((r) => ({ ...r.quoteRequest, companyName: r.brandName || r.companyName, companyPhone: r.companyPhone, projectName: r.projectName, buyerName: r.buyerName, buyerEmail: r.buyerEmail }));
  });

  app.get("/api/supplier/quote-requests/:id", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    const [row] = await db
      .select({ quoteRequest: quoteRequests, companyName: companies.name, brandName: companies.brandName, companyPhone: companies.phone, projectName: projects.name, buyerName: users.name, buyerEmail: users.email })
      .from(quoteRequests)
      .innerJoin(companies, eq(quoteRequests.companyId, companies.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .leftJoin(users, eq(quoteRequests.createdByUserId, users.id))
      .where(and(eq(quoteRequests.id, id), inArray(quoteRequests.supplierId, supplierIds.length ? supplierIds : ["__none__"])))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Pedido não encontrado" });
    const lines = await db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id)).orderBy(quoteRequestLines.sortOrder);
    return { ...row.quoteRequest, companyName: row.brandName || row.companyName, companyPhone: row.companyPhone, projectName: row.projectName, buyerName: row.buyerName, buyerEmail: row.buyerEmail, lines };
  });

  const respondSchema = z.object({
    supplierNotes: z.string().trim().max(2000).optional(),
    lines: z
      .array(
        z.object({
          id: z.string().uuid(),
          unitCost: z.number().nonnegative(),
          notes: z.string().trim().max(500).optional(),
        }),
      )
      .min(1),
  });

  app.post("/api/supplier/quote-requests/:id/respond", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    const [quoteRequest] = await db
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, id), inArray(quoteRequests.supplierId, supplierIds.length ? supplierIds : ["__none__"])))
      .limit(1);
    if (!quoteRequest) return reply.code(404).send({ error: "Pedido não encontrado" });
    // Só pedidos abertos (enviado) ou a rever (respondido) — nunca aceite/cancelado/recusado/expirado.
    if (quoteRequest.status !== "enviado" && quoteRequest.status !== "respondido") {
      return reply.code(409).send({ error: "Este pedido já não pode ser respondido" });
    }

    const parsed = respondSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existingLines = await db.select({ id: quoteRequestLines.id }).from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id));
    const existingIds = new Set(existingLines.map((l) => l.id));
    const respondedIds = new Set(parsed.data.lines.map((l) => l.id));
    for (const line of parsed.data.lines) {
      if (!existingIds.has(line.id)) return reply.code(400).send({ error: "Item de cotação inválido" });
    }
    if (existingIds.size === 0 || respondedIds.size !== existingIds.size || ![...existingIds].every((lid) => respondedIds.has(lid))) {
      return reply.code(400).send({ error: "Tem de indicar o preço de todos os itens do pedido" });
    }

    await db.transaction(async (tx) => {
      for (const line of parsed.data.lines) {
        await tx
          .update(quoteRequestLines)
          .set({ unitCost: line.unitCost.toString(), supplierLineNotes: line.notes ?? null })
          .where(eq(quoteRequestLines.id, line.id));
      }
      await tx
        .update(quoteRequests)
        .set({ status: "respondido", supplierNotes: parsed.data.supplierNotes ?? null, respondedAt: new Date() })
        .where(eq(quoteRequests.id, id));
    });

    void notifyCompanyOfResponse(quoteRequest.companyId, request.currentSupplier!.name, quoteRequest.title, app.log);

    const [updated] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).limit(1);
    return updated;
  });

  // ---------- Ficha e preços no marketplace nacional (SIGO Fornecedores) ----------
  // Catálogo completo (para escolher produtos na página «O que vendo») — independente da selecção.
  app.get("/api/supplier/marketplace/catalog", { preHandler: requireSupplierAuth }, async () => {
    const [materialRows, labourRows, equipmentRows] = await Promise.all([
      db
        .select({ id: materials.id, name: materials.name, unit: materials.unit, category: materials.category, specification: materials.specification })
        .from(materials)
        .where(and(isNull(materials.companyId), eq(materials.isActive, true)))
        .orderBy(materials.category, materials.name),
      db
        .select({ id: labourCategories.id, name: labourCategories.name })
        .from(labourCategories)
        .where(and(isNull(labourCategories.companyId), eq(labourCategories.isActive, true)))
        .orderBy(labourCategories.name),
      db.select({ id: equipment.id, name: equipment.name }).from(equipment).where(isNull(equipment.companyId)).orderBy(equipment.name),
    ]);
    return { materials: materialRows, labourCategories: labourRows, equipment: equipmentRows };
  });

  app.get("/api/supplier/marketplace/profile", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const [matIds, labIds, eqIds] = await Promise.all([
      selectedResourceIds(supplier.id, "material"),
      selectedResourceIds(supplier.id, "labour"),
      selectedResourceIds(supplier.id, "equipment"),
    ]);
    return {
      ...supplier,
      needsOfferSetup: !hasAnyOffer(supplier),
      materialIds: matIds,
      labourCategoryIds: labIds,
      equipmentIds: eqIds,
    };
  });

  const offeringsSchema = z.object({
    offersMaterials: z.boolean(),
    offersLabour: z.boolean(),
    offersEquipment: z.boolean(),
    materialIds: z.array(z.string().uuid()).optional().default([]),
    labourCategoryIds: z.array(z.string().uuid()).optional().default([]),
    equipmentIds: z.array(z.string().uuid()).optional().default([]),
  });

  app.put("/api/supplier/marketplace/offerings", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const parsed = offeringsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const offers = {
      offersMaterials: parsed.data.offersMaterials,
      offersLabour: parsed.data.offersLabour,
      offersEquipment: parsed.data.offersEquipment,
    };
    if (!hasAnyOffer(offers)) return reply.code(400).send({ error: "Seleccione pelo menos um tipo: materiais, mão-de-obra ou máquinas." });
    await setSupplierOffers(supplier.id, offers, {
      materialIds: parsed.data.materialIds,
      labourCategoryIds: parsed.data.labourCategoryIds,
      equipmentIds: parsed.data.equipmentIds,
    });
    const [updated] = await db.select().from(suppliers).where(eq(suppliers.id, supplier.id)).limit(1);
    return updated;
  });

  const createMaterialSchema = z.object({
    name: z.string().trim().min(2).max(200),
    unit: z.enum(["m", "m2", "m3", "ml", "kg", "un", "vg", "h"]),
    category: z.string().trim().min(1).max(100).default("Outros"),
    specification: z.string().trim().max(2000).optional(),
    unitCost: z.number().nonnegative().optional(),
  });

  app.post("/api/supplier/marketplace/materials/create", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const accountId = supplierAccountIdOf(request);
    const supplier = await ensureOwnMarketplaceSupplier(accountId);
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersMaterials) return reply.code(400).send({ error: "A sua conta não oferece materiais — active-os em «O que vendo»." });
    const parsed = createMaterialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [row] = await db
      .insert(materials)
      .values({
        companyId: null,
        name: parsed.data.name,
        unit: parsed.data.unit,
        category: resolveMaterialCategory(parsed.data.name, parsed.data.category, parsed.data.specification),
        specification: parsed.data.specification || null,
        baseUnitCost: (parsed.data.unitCost ?? 0).toString(),
        createdBySupplierAccountId: accountId,
        priceSourceName: supplier.name,
        priceDate: new Date().toISOString().slice(0, 10),
      })
      .returning();
    await addCatalogItem(supplier.id, "material", row.id);
    if (parsed.data.unitCost != null) {
      await db.insert(supplierMaterialPrices).values({
        supplierId: supplier.id,
        materialId: row.id,
        zoneId: supplier.zoneId,
        unitCost: parsed.data.unitCost.toString(),
        currency: "MZN",
      });
    }
    return reply.code(201).send(row);
  });

  const createLabourSchema = z.object({
    name: z.string().trim().min(2).max(150),
    hourlyCost: z.number().nonnegative().optional(),
  });

  app.post("/api/supplier/marketplace/labour/create", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const accountId = supplierAccountIdOf(request);
    const supplier = await ensureOwnMarketplaceSupplier(accountId);
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersLabour) return reply.code(400).send({ error: "A sua conta não oferece mão-de-obra — active-a em «O que vendo»." });
    const parsed = createLabourSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hourly = parsed.data.hourlyCost ?? 0;
    const [row] = await db
      .insert(labourCategories)
      .values({
        companyId: null,
        name: parsed.data.name,
        monthlySalary: (hourly * 176).toString(),
        hourlyRate: hourly.toString(),
        createdBySupplierAccountId: accountId,
        sourceName: supplier.name,
      })
      .returning();
    await addCatalogItem(supplier.id, "labour", row.id);
    if (parsed.data.hourlyCost != null) {
      await db.insert(supplierLabourPrices).values({
        supplierId: supplier.id,
        labourCategoryId: row.id,
        zoneId: supplier.zoneId,
        hourlyCost: hourly.toString(),
        currency: "MZN",
      });
    }
    return reply.code(201).send(row);
  });

  const createEquipmentSchema = z.object({
    name: z.string().trim().min(2).max(200),
    unit: z.enum(["m", "m2", "m3", "ml", "kg", "un", "vg", "h"]).default("h"),
    hourlyCost: z.number().nonnegative().optional(),
  });

  app.post("/api/supplier/marketplace/equipment/create", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const accountId = supplierAccountIdOf(request);
    const supplier = await ensureOwnMarketplaceSupplier(accountId);
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersEquipment) return reply.code(400).send({ error: "A sua conta não oferece máquinas — active-as em «O que vendo»." });
    const parsed = createEquipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hourly = parsed.data.hourlyCost ?? 0;
    const [row] = await db
      .insert(equipment)
      .values({
        companyId: null,
        name: parsed.data.name,
        unit: parsed.data.unit,
        hourlyCost: hourly.toString(),
        createdBySupplierAccountId: accountId,
      })
      .returning();
    await addCatalogItem(supplier.id, "equipment", row.id);
    if (parsed.data.hourlyCost != null) {
      await db.insert(supplierEquipmentPrices).values({
        supplierId: supplier.id,
        equipmentId: row.id,
        zoneId: supplier.zoneId,
        hourlyCost: hourly.toString(),
        currency: "MZN",
      });
    }
    return reply.code(201).send(row);
  });

  const profileSchema = z.object({
    name: z.string().trim().min(1).max(200),
    contact: z.string().trim().max(150).optional(),
    nuit: z.string().trim().max(30).optional(),
    zoneId: z.string().uuid(),
  });

  app.put("/api/supplier/marketplace/profile", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [zone] = await db.select().from(priceZones).where(and(eq(priceZones.id, parsed.data.zoneId), isNull(priceZones.companyId))).limit(1);
    if (!zone) return reply.code(400).send({ error: "Zona inválida" });

    const [row] = await db
      .update(suppliers)
      .set({ name: parsed.data.name, contact: parsed.data.contact || null, nuit: parsed.data.nuit || null, zoneId: zone.id, location: zone.name })
      .where(eq(suppliers.id, supplier.id))
      .returning();
    return row;
  });

  const marketplaceMaterialSchema = z.object({
    materialId: z.string().uuid(),
    unitCost: z.number().nonnegative(),
    currency: z.enum(CURRENCIES).default("MZN"),
    zoneId: z.string().uuid().optional().nullable(),
  });
  const marketplaceLabourSchema = z.object({
    labourCategoryId: z.string().uuid(),
    hourlyCost: z.number().nonnegative(),
    currency: z.enum(CURRENCIES).default("MZN"),
    zoneId: z.string().uuid().optional().nullable(),
  });
  const marketplaceEquipmentSchema = z.object({
    equipmentId: z.string().uuid(),
    hourlyCost: z.number().nonnegative(),
    currency: z.enum(CURRENCIES).default("MZN"),
    zoneId: z.string().uuid().optional().nullable(),
  });

  app.get("/api/supplier/marketplace/materials", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const accountId = supplierAccountIdOf(request);
    const supplier = await ensureOwnMarketplaceSupplier(accountId);
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersMaterials) return [];

    const catalog = await marketplaceMaterialCatalog(accountId, supplier.id);
    const priceRows = await db
      .select({ price: supplierMaterialPrices, zoneName: priceZones.name })
      .from(supplierMaterialPrices)
      .leftJoin(priceZones, eq(supplierMaterialPrices.zoneId, priceZones.id))
      .where(eq(supplierMaterialPrices.supplierId, supplier.id));
    const priceByMaterial = new Map(priceRows.map((r) => [r.price.materialId, r]));

    return catalog.map((m) => {
      const match = priceByMaterial.get(m.id);
      return {
        id: match?.price.id ?? null,
        materialId: m.id,
        materialName: m.name,
        unit: m.unit,
        category: m.category,
        specification: m.specification,
        source: m.source,
        unitCost: match?.price.unitCost ?? null,
        currency: match?.price.currency ?? "MZN",
        zoneName: match?.zoneName ?? null,
      };
    });
  });

  app.put("/api/supplier/marketplace/materials", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const accountId = supplierAccountIdOf(request);
    const supplier = await ensureOwnMarketplaceSupplier(accountId);
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersMaterials) return reply.code(400).send({ error: "A sua conta não oferece materiais." });
    const parsed = marketplaceMaterialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { materialId, unitCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    if (!(await materialAllowedForMarketplace(accountId, supplier.id, materialId))) {
      return reply.code(404).send({ error: "Material não disponível para precificar nesta conta" });
    }
    await addCatalogItem(supplier.id, "material", materialId);

    const zoneFilter = zoneId == null ? isNull(supplierMaterialPrices.zoneId) : eq(supplierMaterialPrices.zoneId, zoneId);
    const [existing] = await db
      .select()
      .from(supplierMaterialPrices)
      .where(and(eq(supplierMaterialPrices.supplierId, supplier.id), eq(supplierMaterialPrices.materialId, materialId), zoneFilter))
      .limit(1);
    if (existing) {
      const [row] = await db.update(supplierMaterialPrices).set({ unitCost: unitCost.toString(), currency }).where(eq(supplierMaterialPrices.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(supplierMaterialPrices).values({ supplierId: supplier.id, materialId, zoneId, unitCost: unitCost.toString(), currency }).returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/supplier/marketplace/materials/:priceId", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { priceId } = request.params as { priceId: string };
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierMaterialPrices).where(and(eq(supplierMaterialPrices.id, priceId), eq(supplierMaterialPrices.supplierId, supplier.id)));
    return { ok: true };
  });

  app.get("/api/supplier/marketplace/labour", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersLabour) return [];
    const ids = await selectedResourceIds(supplier.id, "labour");
    if (!ids.length) return [];
    const categories = await db
      .select({ id: labourCategories.id, name: labourCategories.name })
      .from(labourCategories)
      .where(and(inArray(labourCategories.id, ids), eq(labourCategories.isActive, true)))
      .orderBy(labourCategories.name);
    const priceRows = await db
      .select({ price: supplierLabourPrices, zoneName: priceZones.name })
      .from(supplierLabourPrices)
      .leftJoin(priceZones, eq(supplierLabourPrices.zoneId, priceZones.id))
      .where(eq(supplierLabourPrices.supplierId, supplier.id));
    const byCat = new Map(priceRows.map((r) => [r.price.labourCategoryId, r]));
    return categories.map((c) => {
      const match = byCat.get(c.id);
      return {
        id: match?.price.id ?? null,
        labourCategoryId: c.id,
        labourName: c.name,
        hourlyCost: match?.price.hourlyCost ?? null,
        currency: match?.price.currency ?? "MZN",
        zoneName: match?.zoneName ?? null,
      };
    });
  });

  app.put("/api/supplier/marketplace/labour", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersLabour) return reply.code(400).send({ error: "A sua conta não oferece mão-de-obra." });
    const parsed = marketplaceLabourSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourCategoryId, hourlyCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const selected = await selectedResourceIds(supplier.id, "labour");
    const [category] = await db.select({ id: labourCategories.id }).from(labourCategories).where(eq(labourCategories.id, labourCategoryId)).limit(1);
    if (!category || !selected.includes(labourCategoryId)) {
      return reply.code(404).send({ error: "Categoria não seleccionada na sua oferta — adicione-a em «O que vendo»." });
    }

    const zoneFilter = zoneId == null ? isNull(supplierLabourPrices.zoneId) : eq(supplierLabourPrices.zoneId, zoneId);
    const [existing] = await db
      .select()
      .from(supplierLabourPrices)
      .where(and(eq(supplierLabourPrices.supplierId, supplier.id), eq(supplierLabourPrices.labourCategoryId, labourCategoryId), zoneFilter))
      .limit(1);
    if (existing) {
      const [row] = await db.update(supplierLabourPrices).set({ hourlyCost: hourlyCost.toString(), currency }).where(eq(supplierLabourPrices.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(supplierLabourPrices).values({ supplierId: supplier.id, labourCategoryId, zoneId, hourlyCost: hourlyCost.toString(), currency }).returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/supplier/marketplace/labour/:priceId", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { priceId } = request.params as { priceId: string };
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierLabourPrices).where(and(eq(supplierLabourPrices.id, priceId), eq(supplierLabourPrices.supplierId, supplier.id)));
    return { ok: true };
  });

  app.get("/api/supplier/marketplace/equipment", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersEquipment) return [];
    const ids = await selectedResourceIds(supplier.id, "equipment");
    if (!ids.length) return [];
    const items = await db.select({ id: equipment.id, name: equipment.name }).from(equipment).where(inArray(equipment.id, ids)).orderBy(equipment.name);
    const priceRows = await db
      .select({ price: supplierEquipmentPrices, zoneName: priceZones.name })
      .from(supplierEquipmentPrices)
      .leftJoin(priceZones, eq(supplierEquipmentPrices.zoneId, priceZones.id))
      .where(eq(supplierEquipmentPrices.supplierId, supplier.id));
    const byEq = new Map(priceRows.map((r) => [r.price.equipmentId, r]));
    return items.map((e) => {
      const match = byEq.get(e.id);
      return {
        id: match?.price.id ?? null,
        equipmentId: e.id,
        equipmentName: e.name,
        hourlyCost: match?.price.hourlyCost ?? null,
        currency: match?.price.currency ?? "MZN",
        zoneName: match?.zoneName ?? null,
      };
    });
  });

  app.put("/api/supplier/marketplace/equipment", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    if (!supplier.offersEquipment) return reply.code(400).send({ error: "A sua conta não oferece máquinas." });
    const parsed = marketplaceEquipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { equipmentId, hourlyCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const selected = await selectedResourceIds(supplier.id, "equipment");
    const [equip] = await db.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
    if (!equip || !selected.includes(equipmentId)) {
      return reply.code(404).send({ error: "Equipamento não seleccionado na sua oferta — adicione-o em «O que vendo»." });
    }

    const zoneFilter = zoneId == null ? isNull(supplierEquipmentPrices.zoneId) : eq(supplierEquipmentPrices.zoneId, zoneId);
    const [existing] = await db
      .select()
      .from(supplierEquipmentPrices)
      .where(and(eq(supplierEquipmentPrices.supplierId, supplier.id), eq(supplierEquipmentPrices.equipmentId, equipmentId), zoneFilter))
      .limit(1);
    if (existing) {
      const [row] = await db.update(supplierEquipmentPrices).set({ hourlyCost: hourlyCost.toString(), currency }).where(eq(supplierEquipmentPrices.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(supplierEquipmentPrices).values({ supplierId: supplier.id, equipmentId, zoneId, hourlyCost: hourlyCost.toString(), currency }).returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/supplier/marketplace/equipment/:priceId", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { priceId } = request.params as { priceId: string };
    const supplier = await ensureOwnMarketplaceSupplier(supplierAccountIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierEquipmentPrices).where(and(eq(supplierEquipmentPrices.id, priceId), eq(supplierEquipmentPrices.supplierId, supplier.id)));
    return { ok: true };
  });
}

async function notifyCompanyOfResponse(companyId: string, supplierName: string, title: string, logger: unknown) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  if (!admins.length) return;
  void sendEmail(
    {
      to: admins.map((a) => a.email),
      subject: `SIGO — ${supplierName} respondeu à sua cotação`,
      html: emailLayout(
        "Cotação respondida",
        `<p><strong>${escapeHtml(supplierName)}</strong> respondeu ao pedido de cotação <strong>${escapeHtml(title)}</strong>.</p>
         <p>Reveja os preços e aceite a cotação para guardar as cotações deste fornecedor (não altera o preço base do catálogo usado nos orçamentos).</p>`,
        `${env.publicUrl}/gestao/cotacoes`,
        "Ver pedidos",
      ),
    },
    // sendEmail's logger param typing is a pino instance; pass through what the caller has.
    logger as never,
  );
  await notifyUsers(admins.map((a) => a.id), "Cotação respondida", `${supplierName} respondeu ao pedido "${title}".`, "/gestao/cotacoes");
}
