import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  CURRENCIES,
  DEFAULT_EFFECTIVE_PRICE_MEDIAN_N,
  DEFAULT_EFFECTIVE_PRICE_POLICY,
  EFFECTIVE_PRICE_POLICIES,
  PRICE_OBSERVATION_CONFIDENCES,
  PRICE_OBSERVATION_RESOURCE_TYPES,
  UNITS,
  resolveEffectivePriceFromObservations,
  resolvePriceFreshnessBadge,
  type EffectivePricePolicy,
} from "@sigo/shared";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { db } from "../db/index.js";
import { companies, equipment, labourCategories, materials, priceObservations, priceZones, suppliers } from "../db/schema.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const listQuerySchema = z.object({
  resourceFamilyKey: z.string().uuid().optional(),
  resourceType: z.enum(PRICE_OBSERVATION_RESOURCE_TYPES).optional(),
  refId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  districtId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z.object({
  resourceFamilyKey: z.string().uuid(),
  resourceType: z.enum(PRICE_OBSERVATION_RESOURCE_TYPES),
  refId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  districtId: z.string().uuid().nullable().optional(),
  currency: z.enum(CURRENCIES).default("MZN"),
  unitCost: z.number().positive(),
  unit: z.enum(UNITS),
  vatIncluded: z.boolean().default(false),
  transportIncluded: z.boolean().default(true),
  observedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  source: z.string().trim().min(1).max(240),
  reference: z.string().trim().max(2000).nullable().optional(),
  confidence: z.enum(PRICE_OBSERVATION_CONFIDENCES).default("estimated"),
});

const effectiveQuerySchema = z.object({
  resourceFamilyKey: z.string().uuid(),
  resourceType: z.enum(PRICE_OBSERVATION_RESOURCE_TYPES),
  zoneId: z.string().uuid().optional(),
  districtId: z.string().uuid().optional(),
  policy: z.enum(EFFECTIVE_PRICE_POLICIES).optional(),
  medianN: z.coerce.number().int().min(1).max(50).optional(),
});

function serializeObservation(row: typeof priceObservations.$inferSelect) {
  const badge = resolvePriceFreshnessBadge({
    observedAt: row.observedAt,
    confidence: row.confidence,
  });
  return {
    id: row.id,
    companyId: row.companyId,
    resourceFamilyKey: row.resourceFamilyKey,
    resourceType: row.resourceType,
    refId: row.refId,
    supplierId: row.supplierId,
    zoneId: row.zoneId,
    districtId: row.districtId,
    currency: row.currency,
    unitCost: row.unitCost,
    unit: row.unit,
    vatIncluded: row.vatIncluded,
    transportIncluded: row.transportIncluded,
    observedAt: row.observedAt.toISOString(),
    source: row.source,
    reference: row.reference,
    confidence: row.confidence,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    freshnessBadge: badge,
  };
}

async function getCompanyPricePolicy(companyId: string) {
  const [company] = await db
    .select({
      effectivePricePolicy: companies.effectivePricePolicy,
      effectivePriceMedianN: companies.effectivePriceMedianN,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const policy = (company?.effectivePricePolicy ?? DEFAULT_EFFECTIVE_PRICE_POLICY) as EffectivePricePolicy;
  const medianN = company?.effectivePriceMedianN ?? DEFAULT_EFFECTIVE_PRICE_MEDIAN_N;
  return { policy, medianN };
}

async function assertRefBelongsToCompany(
  companyId: string,
  resourceType: (typeof PRICE_OBSERVATION_RESOURCE_TYPES)[number],
  refId: string | null | undefined,
) {
  if (!refId) return;
  if (resourceType === "material") {
    const [row] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.id, refId), or(eq(materials.companyId, companyId), isNull(materials.companyId)))).limit(1);
    if (!row) throw new Error("Material de referência inválido");
    return;
  }
  if (resourceType === "labour") {
    const [row] = await db.select({ id: labourCategories.id }).from(labourCategories).where(and(eq(labourCategories.id, refId), or(eq(labourCategories.companyId, companyId), isNull(labourCategories.companyId)))).limit(1);
    if (!row) throw new Error("Mão-de-obra de referência inválida");
    return;
  }
  const [row] = await db.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.id, refId), or(eq(equipment.companyId, companyId), isNull(equipment.companyId)))).limit(1);
  if (!row) throw new Error("Equipamento de referência inválido");
}

export async function priceObservationRoutes(app: FastifyInstance) {
  app.get("/api/price-observations", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const filters = [eq(priceObservations.companyId, companyId)];
    if (parsed.data.resourceFamilyKey) filters.push(eq(priceObservations.resourceFamilyKey, parsed.data.resourceFamilyKey));
    if (parsed.data.resourceType) filters.push(eq(priceObservations.resourceType, parsed.data.resourceType));
    if (parsed.data.refId) filters.push(eq(priceObservations.refId, parsed.data.refId));
    if (parsed.data.zoneId) filters.push(eq(priceObservations.zoneId, parsed.data.zoneId));
    if (parsed.data.districtId) filters.push(eq(priceObservations.districtId, parsed.data.districtId));

    const rows = await db
      .select()
      .from(priceObservations)
      .where(and(...filters))
      .orderBy(desc(priceObservations.observedAt), desc(priceObservations.createdAt))
      .limit(parsed.data.limit);

    return { observations: rows.map(serializeObservation) };
  });

  app.post("/api/price-observations", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      await assertRefBelongsToCompany(companyId, parsed.data.resourceType, parsed.data.refId ?? null);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Referência inválida" });
    }

    if (parsed.data.supplierId) {
      const [supplier] = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, parsed.data.supplierId), or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId))))
        .limit(1);
      if (!supplier) return reply.code(400).send({ error: "Fornecedor inválido" });
    }

    if (parsed.data.zoneId) {
      const [zone] = await db
        .select({ id: priceZones.id })
        .from(priceZones)
        .where(and(eq(priceZones.id, parsed.data.zoneId), or(eq(priceZones.companyId, companyId), isNull(priceZones.companyId))))
        .limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    }

    const observedAt = parsed.data.observedAt.length === 10
      ? new Date(`${parsed.data.observedAt}T12:00:00.000Z`)
      : new Date(parsed.data.observedAt);

    const [row] = await db
      .insert(priceObservations)
      .values({
        companyId,
        resourceFamilyKey: parsed.data.resourceFamilyKey,
        resourceType: parsed.data.resourceType,
        refId: parsed.data.refId ?? null,
        supplierId: parsed.data.supplierId ?? null,
        zoneId: parsed.data.zoneId ?? null,
        districtId: parsed.data.districtId ?? null,
        currency: parsed.data.currency,
        unitCost: parsed.data.unitCost.toString(),
        unit: parsed.data.unit,
        vatIncluded: parsed.data.vatIncluded,
        transportIncluded: parsed.data.transportIncluded,
        observedAt,
        source: parsed.data.source,
        reference: parsed.data.reference ?? null,
        confidence: parsed.data.confidence,
        createdByUserId: request.currentUser!.id,
      })
      .returning();

    return reply.code(201).send({ observation: serializeObservation(row) });
  });

  app.get("/api/price-observations/effective", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const parsed = effectiveQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyPolicy = await getCompanyPricePolicy(companyId);
    const policy = parsed.data.policy ?? companyPolicy.policy;
    const medianN = parsed.data.medianN ?? companyPolicy.medianN;

    if (policy === "manual") {
      return {
        policy,
        effective: null,
        message: "Política manual — selecione o preço directamente no orçamento.",
      };
    }

    const filters = [
      eq(priceObservations.companyId, companyId),
      eq(priceObservations.resourceFamilyKey, parsed.data.resourceFamilyKey),
      eq(priceObservations.resourceType, parsed.data.resourceType),
    ];
    if (parsed.data.zoneId) filters.push(eq(priceObservations.zoneId, parsed.data.zoneId));
    if (parsed.data.districtId) filters.push(eq(priceObservations.districtId, parsed.data.districtId));

    const rows = await db
      .select()
      .from(priceObservations)
      .where(and(...filters))
      .orderBy(desc(priceObservations.observedAt), desc(priceObservations.createdAt))
      .limit(200);

    const effective = resolveEffectivePriceFromObservations(
      rows.map((row) => ({
        id: row.id,
        unitCost: Number(row.unitCost),
        observedAt: row.observedAt,
        confidence: row.confidence,
      })),
      policy,
      medianN,
    );

    return {
      policy,
      medianN: policy === "median_n" ? medianN : undefined,
      effective: effective
        ? {
            unitCost: effective.unitCost,
            observationCount: effective.observationCount,
            sourceObservationIds: effective.sourceObservationIds,
            observedAt: effective.observedAt,
            source: effective.source,
          }
        : null,
    };
  });
}
