import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, eq, ilike, isNull, isNotNull, or, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { suppliers, priceZones, supplierMaterialPrices, supplierLabourPrices, supplierEquipmentPrices, materials } from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { SIGO_PRICES_SUPPLIER_NAME } from "../services/sigoPrices.js";
import { selectedResourceIds } from "../services/supplierOfferings.js";
import { loadCompanyVendorGovernanceMap } from "../services/companyVendorGovernance.js";

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

function truthyQuery(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

// SIGO Fornecedores — o marketplace nacional de fornecedores registados directamente (fora do
// painel de qualquer empresa, ver routes/supplierAuth.ts:register). Abaixo do plano Profissional,
// a empresa só vê quantos fornecedores existem por zona (teaser para o upgrade), nunca as fichas.
export async function marketplaceRoutes(app: FastifyInstance) {
  app.get("/api/marketplace/suppliers", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = companyIdOf(request);
    const { zoneId, q, inviteable } = request.query as { zoneId?: string; q?: string; inviteable?: string };
    const needle = (q ?? "").trim();
    const inviteableOnly = truthyQuery(inviteable);

    const blocked = await assertSupplierMarketplaceAccess(companyId);

    const filter = and(
      ...[
        isNull(suppliers.companyId),
        zoneId ? eq(suppliers.zoneId, zoneId) : undefined,
        inviteableOnly ? isNotNull(suppliers.supplierAccountId) : undefined,
      ].filter((clause): clause is NonNullable<typeof clause> => clause != null),
    );

    if (blocked) {
      const [{ value }] = await db.select({ value: count() }).from(suppliers).where(filter);
      // Com plano Individual ainda pode pesquisar SIGO Preços da própria empresa por material.
      if (needle) {
        const sigoHits = await searchSuppliersByMaterial(companyId, needle, zoneId, { marketplace: false });
        return { locked: true, ...blocked, count: value, materialMatches: sigoHits };
      }
      return { locked: true, ...blocked, count: value, materialMatches: [] };
    }

    const rows = await db
      .select({ supplier: suppliers, zoneName: priceZones.name })
      .from(suppliers)
      .leftJoin(priceZones, eq(suppliers.zoneId, priceZones.id))
      .where(filter)
      .orderBy(suppliers.name);

    const supplierIds = rows.map((r) => r.supplier.id);
    const materialTotals = supplierIds.length
      ? await db.select({ supplierId: supplierMaterialPrices.supplierId, total: count() }).from(supplierMaterialPrices).groupBy(supplierMaterialPrices.supplierId)
      : [];
    const labourTotals = supplierIds.length
      ? await db.select({ supplierId: supplierLabourPrices.supplierId, total: count() }).from(supplierLabourPrices).groupBy(supplierLabourPrices.supplierId)
      : [];
    const equipmentTotals = supplierIds.length
      ? await db.select({ supplierId: supplierEquipmentPrices.supplierId, total: count() }).from(supplierEquipmentPrices).groupBy(supplierEquipmentPrices.supplierId)
      : [];
    const materialBySupplier = new Map(materialTotals.map((r) => [r.supplierId, r.total]));
    const labourBySupplier = new Map(labourTotals.map((r) => [r.supplierId, r.total]));
    const equipmentBySupplier = new Map(equipmentTotals.map((r) => [r.supplierId, r.total]));
    const companyGovernance = await loadCompanyVendorGovernanceMap(companyId, supplierIds);

    let suppliersOut = rows.map((r) => {
      const override = companyGovernance.get(r.supplier.id);
      return {
        ...r.supplier,
        governanceStatus: override?.governanceStatus ?? r.supplier.governanceStatus,
        blockedReason: override ? override.blockedReason : r.supplier.blockedReason,
        companyGovernance: Boolean(override),
        zoneName: r.zoneName,
        materialCount: materialBySupplier.get(r.supplier.id) ?? 0,
        labourCount: labourBySupplier.get(r.supplier.id) ?? 0,
        equipmentCount: equipmentBySupplier.get(r.supplier.id) ?? 0,
        matchedMaterials: [] as string[],
      };
    });

    let materialMatches: Awaited<ReturnType<typeof searchSuppliersByMaterial>> = [];
    if (needle) {
      materialMatches = await searchSuppliersByMaterial(companyId, needle, zoneId, { marketplace: true });
      const matchIds = new Set(materialMatches.map((m) => m.supplierId));
      const byName = needle.toLocaleLowerCase("pt");
      suppliersOut = suppliersOut.filter((s) => s.name.toLocaleLowerCase("pt").includes(byName) || matchIds.has(s.id));
      for (const s of suppliersOut) {
        s.matchedMaterials = materialMatches.find((m) => m.supplierId === s.id)?.materials ?? [];
      }
    }

    return {
      locked: false,
      suppliers: suppliersOut,
      materialMatches,
    };
  });

  /** Catálogo do que o fornecedor marketplace declara vender — usado ao pedir cotação. */
  app.get("/api/marketplace/suppliers/:id/catalog", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = companyIdOf(request);
    const blocked = await assertSupplierMarketplaceAccess(companyId);
    if (blocked) return reply.code(402).send(blocked);

    const { id } = request.params as { id: string };
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.companyId)))
      .limit(1);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor do marketplace não encontrado" });

    const materialIds = await selectedResourceIds(id, "material");
    const materialRows = materialIds.length
      ? await db
          .select({
            id: materials.id,
            name: materials.name,
            unit: materials.unit,
            category: materials.category,
            specification: materials.specification,
          })
          .from(materials)
          .where(and(inArray(materials.id, materialIds), eq(materials.isActive, true), isNull(materials.companyId)))
          .orderBy(materials.category, materials.name)
      : [];

    const prices = materialIds.length
      ? await db
          .select({
            materialId: supplierMaterialPrices.materialId,
            unitCost: supplierMaterialPrices.unitCost,
            currency: supplierMaterialPrices.currency,
          })
          .from(supplierMaterialPrices)
          .where(and(eq(supplierMaterialPrices.supplierId, id), inArray(supplierMaterialPrices.materialId, materialIds)))
      : [];
    const priceByMaterial = new Map(prices.map((row) => [row.materialId, row]));

    return {
      supplier: { id: supplier.id, name: supplier.name, location: supplier.location },
      materials: materialRows.map((row) => ({
        ...row,
        unitCost: priceByMaterial.get(row.id)?.unitCost ?? null,
        currency: priceByMaterial.get(row.id)?.currency ?? "MZN",
      })),
    };
  });
}

async function searchSuppliersByMaterial(
  companyId: string,
  needle: string,
  zoneId: string | undefined,
  opts: { marketplace: boolean },
) {
  const pattern = `%${needle}%`;
  const scope = opts.marketplace
    ? or(and(eq(suppliers.companyId, companyId), eq(suppliers.name, SIGO_PRICES_SUPPLIER_NAME)), isNull(suppliers.companyId))
    : and(eq(suppliers.companyId, companyId), eq(suppliers.name, SIGO_PRICES_SUPPLIER_NAME));

  const zoneFilter = zoneId
    ? or(eq(supplierMaterialPrices.zoneId, zoneId), and(isNull(supplierMaterialPrices.zoneId), eq(suppliers.zoneId, zoneId)), and(isNull(supplierMaterialPrices.zoneId), isNull(suppliers.zoneId)))
    : undefined;

  const rows = await db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierCompanyId: suppliers.companyId,
      contact: suppliers.contact,
      zoneName: priceZones.name,
      materialName: materials.name,
      unitCost: supplierMaterialPrices.unitCost,
      currency: supplierMaterialPrices.currency,
      unit: materials.unit,
    })
    .from(supplierMaterialPrices)
    .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
    .innerJoin(materials, eq(supplierMaterialPrices.materialId, materials.id))
    .leftJoin(priceZones, eq(sql`coalesce(${supplierMaterialPrices.zoneId}, ${suppliers.zoneId})`, priceZones.id))
    .where(and(scope, ilike(materials.name, pattern), zoneFilter))
    .limit(200);

  const bySupplier = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      isMarketplace: boolean;
      isReference: boolean;
      contact: string | null;
      zoneName: string | null;
      materials: string[];
    }
  >();

  for (const row of rows) {
    let entry = bySupplier.get(row.supplierId);
    if (!entry) {
      entry = {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        isMarketplace: row.supplierCompanyId === null,
        isReference: row.supplierName === SIGO_PRICES_SUPPLIER_NAME,
        contact: row.contact,
        zoneName: row.zoneName,
        materials: [],
      };
      bySupplier.set(row.supplierId, entry);
    }
    if (entry.materials.length < 5 && !entry.materials.includes(row.materialName)) {
      entry.materials.push(row.materialName);
    }
  }

  return [...bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, "pt"));
}
