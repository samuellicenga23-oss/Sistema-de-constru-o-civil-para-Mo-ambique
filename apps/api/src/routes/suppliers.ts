import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  suppliers,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
  supplierPriceFeeds,
  materials,
  labourCategories,
  equipment,
  priceZones,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { CURRENCIES } from "@sigo/shared";
import {
  isSigoPricesSupplier,
  SIGO_PRICES_REVIEW_DATE,
  syncSigoPricesForCompany,
} from "../services/sigoPrices.js";
import { syncSupplierPriceFeed } from "../services/supplierPriceFeed.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const COMPANY_PRICEBOOK_FORBIDDEN =
  "Os preços e produtos do fornecedor só podem ser geridos no Portal do Fornecedor. No SIGO pode consultar e pedir confirmação de preço/disponibilidade com quantidades.";

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

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

// Só a ficha "SIGO Preços" da própria empresa (companyId = a empresa) — é a única forma de
// fornecedor que uma empresa ainda gere directamente. Fornecedores do marketplace (companyId
// null) só o próprio fornecedor edita, através do Portal do Fornecedor.
async function assertSupplierOwned(supplierId: string, companyId: string) {
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId))).limit(1);
  return supplier ?? null;
}

// Leitura: a própria ficha SIGO Preços OU qualquer fornecedor do marketplace nacional
// (companyId null) — usado só nas rotas GET de consulta de preços, nunca nas de escrita.
async function assertSupplierReadable(supplierId: string, companyId: string) {
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId))))
    .limit(1);
  return supplier ?? null;
}

export async function supplierRoutes(app: FastifyInstance) {
  // Só devolve a ficha SIGO Preços — a empresa deixou de gerir fornecedores próprios; para ver o
  // marketplace nacional de fornecedores reais, ver GET /api/marketplace/suppliers.
  app.get("/api/suppliers", { preHandler: requireCompanyUser }, async (request) => {
    const reference = await syncSigoPricesForCompany(companyIdOf(request));
    const rows = await db.select().from(suppliers).where(eq(suppliers.companyId, companyIdOf(request))).orderBy(suppliers.name);
    return rows.map((supplier) => ({
      ...supplier,
      isReference: isSigoPricesSupplier(supplier),
      referenceMaterialCount: supplier.id === reference.supplier.id ? reference.materials : null,
      referenceDate: supplier.id === reference.supplier.id ? SIGO_PRICES_REVIEW_DATE : null,
    }));
  });

  // ---------- Preços de materiais por fornecedor (e opcionalmente por zona) ----------
  // Isto é o que faz aparecer "materiais" dentro de um fornecedor — ver também
  // GET /api/catalog/materials/:id/suppliers em catalog.ts para o lado inverso (fornecedores
  // dentro de um material), sobre os mesmos dados. Fornecedores do marketplace exigem o plano
  // Profissional (ver assertSupplierMarketplaceAccess); a ficha SIGO Preços da própria empresa
  // está sempre acessível, em qualquer plano.
  app.get("/api/suppliers/:id/materials", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierReadable(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    if (supplier.companyId === null) {
      const blocked = await assertSupplierMarketplaceAccess(companyId);
      if (blocked) return reply.code(402).send(blocked);
    }

    const rows = await db
      .select({
        price: supplierMaterialPrices,
        materialName: materials.name,
        materialUnit: materials.unit,
        materialSourceName: materials.priceSourceName,
        materialPriceDate: materials.priceDate,
        zoneName: priceZones.name,
      })
      .from(supplierMaterialPrices)
      .innerJoin(materials, eq(supplierMaterialPrices.materialId, materials.id))
      .leftJoin(priceZones, eq(supplierMaterialPrices.zoneId, priceZones.id))
      .where(eq(supplierMaterialPrices.supplierId, id));

    return rows.map((r) => ({
      ...r.price,
      materialName: r.materialName,
      unit: r.materialUnit,
      materialSourceName: r.materialSourceName,
      materialPriceDate: r.materialPriceDate,
      zoneName: r.zoneName,
    }));
  });

  app.put("/api/suppliers/:id/materials", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  app.delete("/api/suppliers/:id/materials/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  // ---------- Preços de mão-de-obra subcontratada por fornecedor ----------
  app.get("/api/suppliers/:id/labour", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierReadable(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    if (supplier.companyId === null) {
      const blocked = await assertSupplierMarketplaceAccess(companyId);
      if (blocked) return reply.code(402).send(blocked);
    }

    const rows = await db
      .select({ price: supplierLabourPrices, labourName: labourCategories.name, zoneName: priceZones.name })
      .from(supplierLabourPrices)
      .innerJoin(labourCategories, eq(supplierLabourPrices.labourCategoryId, labourCategories.id))
      .leftJoin(priceZones, eq(supplierLabourPrices.zoneId, priceZones.id))
      .where(eq(supplierLabourPrices.supplierId, id));

    return rows.map((r) => ({ ...r.price, labourName: r.labourName, zoneName: r.zoneName }));
  });

  app.put("/api/suppliers/:id/labour", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  app.delete("/api/suppliers/:id/labour/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  // ---------- Preços de máquinas/equipamento alugado por fornecedor ----------
  app.get("/api/suppliers/:id/equipment", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierReadable(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    if (supplier.companyId === null) {
      const blocked = await assertSupplierMarketplaceAccess(companyId);
      if (blocked) return reply.code(402).send(blocked);
    }

    const rows = await db
      .select({ price: supplierEquipmentPrices, equipmentName: equipment.name, zoneName: priceZones.name })
      .from(supplierEquipmentPrices)
      .innerJoin(equipment, eq(supplierEquipmentPrices.equipmentId, equipment.id))
      .leftJoin(priceZones, eq(supplierEquipmentPrices.zoneId, priceZones.id))
      .where(eq(supplierEquipmentPrices.supplierId, id));

    return rows.map((r) => ({ ...r.price, equipmentName: r.equipmentName, zoneName: r.zoneName }));
  });

  app.put("/api/suppliers/:id/equipment", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  app.delete("/api/suppliers/:id/equipment/:priceId", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(403).send({ error: COMPANY_PRICEBOOK_FORBIDDEN });
  });

  // ---------- Ligação automática de preços (feed externo do fornecedor) ----------
  // Alternativa a responder pedidos de cotação um a um no Portal do Fornecedor: se o fornecedor
  // tiver o seu próprio sistema com uma URL que devolva os preços em JSON, o SIGO pode ir
  // buscá-los periodicamente sozinho. Ver services/supplierPriceFeed.ts para o contrato.
  const feedSchema = z.object({
    feedUrl: z.string().trim().url().max(2000),
    apiKey: z.string().trim().max(500).optional(),
    intervalHours: z.number().int().min(1).max(24 * 30).default(24),
    isActive: z.boolean().default(true),
  });

  app.get("/api/suppliers/:id/price-feed", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    const [feed] = await db.select().from(supplierPriceFeeds).where(eq(supplierPriceFeeds.supplierId, id)).limit(1);
    if (!feed) return null;
    const { apiKey, ...rest } = feed;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  });

  app.put("/api/suppliers/:id/price-feed", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const supplier = await assertSupplierOwned(id, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    const parsed = feedSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [existing] = await db.select().from(supplierPriceFeeds).where(eq(supplierPriceFeeds.supplierId, id)).limit(1);
    const values = {
      feedUrl: parsed.data.feedUrl,
      // Só substitui a chave se uma nova vier no pedido — o frontend nunca recebe a chave
      // gravada de volta, por isso não tem como reenviá-la sem querer mudá-la.
      apiKey: parsed.data.apiKey !== undefined ? parsed.data.apiKey || null : (existing?.apiKey ?? null),
      intervalHours: parsed.data.intervalHours,
      isActive: parsed.data.isActive,
      updatedAt: new Date(),
    };

    const [feed] = existing
      ? await db.update(supplierPriceFeeds).set(values).where(eq(supplierPriceFeeds.id, existing.id)).returning()
      : await db.insert(supplierPriceFeeds).values({ supplierId: id, ...values }).returning();

    const { apiKey, ...rest } = feed;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  });

  app.delete("/api/suppliers/:id/price-feed", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await assertSupplierOwned(id, companyIdOf(request));
    if (!supplier) return { ok: true };
    await db.delete(supplierPriceFeeds).where(eq(supplierPriceFeeds.supplierId, id));
    return { ok: true };
  });

  app.post(
    "/api/suppliers/:id/price-feed/sync",
    { preHandler: requireRole(...WRITE_ROLES) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const supplier = await assertSupplierOwned(id, companyIdOf(request));
      if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
      const result = await syncSupplierPriceFeed(id);
      if (!result.ok) return reply.code(422).send({ error: result.error });
      return result;
    },
  );
}
