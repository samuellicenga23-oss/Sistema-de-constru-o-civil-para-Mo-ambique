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
} from "../db/schema.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { sendEmail, emailLayout, escapeHtml } from "../services/mailer.js";
import { listNotificationsForSupplierAccount, markAllNotificationsRead, markNotificationRead, notifyUsers } from "../services/notifications.js";
import { CURRENCIES } from "@sigo/shared";
import { env } from "../env.js";

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
  // Catálogo nacional (só recursos globais) para o fornecedor escolher o que quer preçar — não
  // tem sessão de empresa, por isso não pode usar as rotas /api/catalog/* normais.
  app.get("/api/supplier/marketplace/catalog", { preHandler: requireSupplierAuth }, async () => {
    const [materialRows, labourRows, equipmentRows] = await Promise.all([
      db.select({ id: materials.id, name: materials.name, unit: materials.unit }).from(materials).where(and(isNull(materials.companyId), eq(materials.isActive, true))).orderBy(materials.name),
      db.select({ id: labourCategories.id, name: labourCategories.name }).from(labourCategories).where(and(isNull(labourCategories.companyId), eq(labourCategories.isActive, true))).orderBy(labourCategories.name),
      db.select({ id: equipment.id, name: equipment.name }).from(equipment).where(isNull(equipment.companyId)).orderBy(equipment.name),
    ]);
    return { materials: materialRows, labourCategories: labourRows, equipment: equipmentRows };
  });

  app.get("/api/supplier/marketplace/profile", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    return supplier;
  });

  const profileSchema = z.object({
    name: z.string().trim().min(1).max(200),
    contact: z.string().trim().max(150).optional(),
    nuit: z.string().trim().max(30).optional(),
    zoneId: z.string().uuid(),
  });

  app.put("/api/supplier/marketplace/profile", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
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
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const rows = await db
      .select({ price: supplierMaterialPrices, materialName: materials.name, unit: materials.unit, zoneName: priceZones.name })
      .from(supplierMaterialPrices)
      .innerJoin(materials, eq(supplierMaterialPrices.materialId, materials.id))
      .leftJoin(priceZones, eq(supplierMaterialPrices.zoneId, priceZones.id))
      .where(eq(supplierMaterialPrices.supplierId, supplier.id));
    return rows.map((r) => ({ ...r.price, materialName: r.materialName, unit: r.unit, zoneName: r.zoneName }));
  });

  app.put("/api/supplier/marketplace/materials", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const parsed = marketplaceMaterialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { materialId, unitCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const [material] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.id, materialId), isNull(materials.companyId))).limit(1);
    if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo nacional" });

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
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierMaterialPrices).where(and(eq(supplierMaterialPrices.id, priceId), eq(supplierMaterialPrices.supplierId, supplier.id)));
    return { ok: true };
  });

  app.get("/api/supplier/marketplace/labour", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const rows = await db
      .select({ price: supplierLabourPrices, labourName: labourCategories.name, zoneName: priceZones.name })
      .from(supplierLabourPrices)
      .innerJoin(labourCategories, eq(supplierLabourPrices.labourCategoryId, labourCategories.id))
      .leftJoin(priceZones, eq(supplierLabourPrices.zoneId, priceZones.id))
      .where(eq(supplierLabourPrices.supplierId, supplier.id));
    return rows.map((r) => ({ ...r.price, labourName: r.labourName, zoneName: r.zoneName }));
  });

  app.put("/api/supplier/marketplace/labour", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const parsed = marketplaceLabourSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { labourCategoryId, hourlyCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const [category] = await db.select({ id: labourCategories.id }).from(labourCategories).where(and(eq(labourCategories.id, labourCategoryId), isNull(labourCategories.companyId))).limit(1);
    if (!category) return reply.code(404).send({ error: "Categoria de mão-de-obra não encontrada no Catálogo nacional" });

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
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierLabourPrices).where(and(eq(supplierLabourPrices.id, priceId), eq(supplierLabourPrices.supplierId, supplier.id)));
    return { ok: true };
  });

  app.get("/api/supplier/marketplace/equipment", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const rows = await db
      .select({ price: supplierEquipmentPrices, equipmentName: equipment.name, zoneName: priceZones.name })
      .from(supplierEquipmentPrices)
      .innerJoin(equipment, eq(supplierEquipmentPrices.equipmentId, equipment.id))
      .leftJoin(priceZones, eq(supplierEquipmentPrices.zoneId, priceZones.id))
      .where(eq(supplierEquipmentPrices.supplierId, supplier.id));
    return rows.map((r) => ({ ...r.price, equipmentName: r.equipmentName, zoneName: r.zoneName }));
  });

  app.put("/api/supplier/marketplace/equipment", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Ficha de marketplace não encontrada" });
    const parsed = marketplaceEquipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { equipmentId, hourlyCost, currency } = parsed.data;
    const zoneId = parsed.data.zoneId ?? supplier.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const [equip] = await db.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.id, equipmentId), isNull(equipment.companyId))).limit(1);
    if (!equip) return reply.code(404).send({ error: "Equipamento não encontrado no Catálogo nacional" });

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
    const supplier = await ownGlobalSupplier(supplierAccountIdOf(request));
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
