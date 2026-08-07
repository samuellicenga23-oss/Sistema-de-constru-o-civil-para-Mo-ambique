import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { suppliers, priceZones, supplierMaterialPrices, supplierLabourPrices, supplierEquipmentPrices } from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

// SIGO Fornecedores — o marketplace nacional de fornecedores registados directamente (fora do
// painel de qualquer empresa, ver routes/supplierAuth.ts:register). Abaixo do plano Profissional,
// a empresa só vê quantos fornecedores existem por zona (teaser para o upgrade), nunca as fichas.
export async function marketplaceRoutes(app: FastifyInstance) {
  app.get("/api/marketplace/suppliers", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = companyIdOf(request);
    const { zoneId } = request.query as { zoneId?: string };

    const blocked = await assertSupplierMarketplaceAccess(companyId);

    const filter = zoneId ? and(isNull(suppliers.companyId), eq(suppliers.zoneId, zoneId)) : isNull(suppliers.companyId);

    if (blocked) {
      const [{ value }] = await db.select({ value: count() }).from(suppliers).where(filter);
      return { locked: true, ...blocked, count: value };
    }

    const rows = await db
      .select({ supplier: suppliers, zoneName: priceZones.name })
      .from(suppliers)
      .leftJoin(priceZones, eq(suppliers.zoneId, priceZones.id))
      .where(filter)
      .orderBy(suppliers.name);

    const supplierIds = rows.map((r) => r.supplier.id);
    // Uma query agregada por tabela (não uma por fornecedor) para as contagens de preços.
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

    return {
      locked: false,
      suppliers: rows.map((r) => ({
        ...r.supplier,
        zoneName: r.zoneName,
        materialCount: materialBySupplier.get(r.supplier.id) ?? 0,
        labourCount: labourBySupplier.get(r.supplier.id) ?? 0,
        equipmentCount: equipmentBySupplier.get(r.supplier.id) ?? 0,
      })),
    };
  });
}
