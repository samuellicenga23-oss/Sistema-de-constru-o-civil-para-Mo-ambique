import type { FastifyInstance } from "fastify";
import { asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  MZ_COUNTRY_PROFILE,
  MZ_PAYMENT_METHODS,
  maputoTodayIso,
  resolveFiscalRateOnDate,
  type FiscalRateKind,
} from "@sigo/shared";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { db } from "../db/index.js";
import { fiscalRateProfiles, mzDistricts, mzProvinces, paymentMethodCatalog, priceZoneDistricts } from "../db/schema.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

export async function countryMzRoutes(app: FastifyInstance) {
  app.get("/api/country-profile", async () => ({
    profile: MZ_COUNTRY_PROFILE,
    paymentMethods: MZ_PAYMENT_METHODS,
  }));

  app.get("/api/mz/provinces", { preHandler: requireCompanyUser }, async () => {
    const rows = await db.select().from(mzProvinces).orderBy(asc(mzProvinces.name));
    return { provinces: rows };
  });

  app.get("/api/mz/districts", { preHandler: requireCompanyUser }, async (request) => {
    const query = z.object({ provinceCode: z.string().min(1).max(8).optional() }).safeParse(request.query);
    const provinceCode = query.success ? query.data.provinceCode : undefined;
    const rows = provinceCode
      ? await db.select().from(mzDistricts).where(eq(mzDistricts.provinceCode, provinceCode)).orderBy(asc(mzDistricts.name))
      : await db.select().from(mzDistricts).orderBy(asc(mzDistricts.name));
    return { districts: rows };
  });

  app.get("/api/payment-methods", { preHandler: requireCompanyUser }, async () => {
    const rows = await db
      .select()
      .from(paymentMethodCatalog)
      .where(eq(paymentMethodCatalog.isActive, true))
      .orderBy(asc(paymentMethodCatalog.sortOrder));
    return { methods: rows.length ? rows : MZ_PAYMENT_METHODS.map((m) => ({ ...m, isActive: true, sortOrder: 0 })) };
  });

  app.get("/api/fiscal-rates", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const query = z
      .object({
        kind: z.enum(["iva", "inss_employer", "inss_worker", "other"]).optional(),
        onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(request.query);
    const onDate = query.success && query.data.onDate ? query.data.onDate : maputoTodayIso();
    const kind = query.success ? query.data.kind : undefined;

    const rows = await db
      .select()
      .from(fiscalRateProfiles)
      .where(or(isNull(fiscalRateProfiles.companyId), eq(fiscalRateProfiles.companyId, companyId)))
      .orderBy(asc(fiscalRateProfiles.kind), asc(fiscalRateProfiles.effectiveFrom));

    const mapped = rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      kind: row.kind as FiscalRateKind,
      rate: Number(row.rate),
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      source: row.source,
      reference: row.reference,
    }));

    const kinds: FiscalRateKind[] = kind ? [kind] : ["iva", "inss_employer", "inss_worker"];
    const resolved = Object.fromEntries(
      kinds.map((k) => {
        const companyRows = mapped.filter((r) => r.companyId === companyId);
        const nationalRows = mapped.filter((r) => r.companyId == null);
        const hit = resolveFiscalRateOnDate(companyRows, k, onDate) ?? resolveFiscalRateOnDate(nationalRows, k, onDate);
        return [k, hit];
      }),
    );

    return { onDate, resolved, profiles: mapped };
  });

  app.post("/api/fiscal-rates", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const parsed = z
      .object({
        kind: z.enum(["iva", "inss_employer", "inss_worker", "other"]),
        rate: z.number().min(0).max(1),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        source: z.string().max(240).nullable().optional(),
        reference: z.string().max(2000).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [row] = await db
      .insert(fiscalRateProfiles)
      .values({
        companyId,
        kind: parsed.data.kind,
        rate: parsed.data.rate.toFixed(6),
        effectiveFrom: parsed.data.effectiveFrom,
        effectiveTo: parsed.data.effectiveTo ?? null,
        source: parsed.data.source ?? null,
        reference: parsed.data.reference ?? null,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/price-zones/:id/districts", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ districtIds: z.array(z.string().uuid()).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db.delete(priceZoneDistricts).where(eq(priceZoneDistricts.zoneId, id));
    if (parsed.data.districtIds.length) {
      await db.insert(priceZoneDistricts).values(parsed.data.districtIds.map((districtId) => ({ zoneId: id, districtId })));
    }
    const linked = await db.select().from(priceZoneDistricts).where(eq(priceZoneDistricts.zoneId, id));
    return { zoneId: id, districtIds: linked.map((row) => row.districtId) };
  });

  app.get("/api/price-zones/:id/districts", { preHandler: requireCompanyUser }, async (request) => {
    const { id } = request.params as { id: string };
    const linked = await db
      .select({
        districtId: mzDistricts.id,
        code: mzDistricts.code,
        name: mzDistricts.name,
        provinceCode: mzDistricts.provinceCode,
      })
      .from(priceZoneDistricts)
      .innerJoin(mzDistricts, eq(priceZoneDistricts.districtId, mzDistricts.id))
      .where(eq(priceZoneDistricts.zoneId, id));
    return { zoneId: id, districts: linked };
  });
}
