import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { supplierCatalogItems, suppliers } from "../db/schema.js";

export type SupplierOfferKinds = {
  offersMaterials: boolean;
  offersLabour: boolean;
  offersEquipment: boolean;
};

export function hasAnyOffer(o: SupplierOfferKinds) {
  return o.offersMaterials || o.offersLabour || o.offersEquipment;
}

export async function setSupplierOffers(
  supplierId: string,
  offers: SupplierOfferKinds,
  selection: {
    materialIds?: string[];
    labourCategoryIds?: string[];
    equipmentIds?: string[];
  } = {},
) {
  await db
    .update(suppliers)
    .set({
      offersMaterials: offers.offersMaterials,
      offersLabour: offers.offersLabour,
      offersEquipment: offers.offersEquipment,
    })
    .where(eq(suppliers.id, supplierId));

  if (offers.offersMaterials) {
    const ids = [...new Set(selection.materialIds ?? [])];
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "material")));
    if (ids.length) {
      await db.insert(supplierCatalogItems).values(ids.map((materialId) => ({ supplierId, kind: "material", materialId })));
    }
  } else {
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "material")));
  }

  if (offers.offersLabour) {
    const ids = [...new Set(selection.labourCategoryIds ?? [])];
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "labour")));
    if (ids.length) {
      await db.insert(supplierCatalogItems).values(ids.map((labourCategoryId) => ({ supplierId, kind: "labour", labourCategoryId })));
    }
  } else {
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "labour")));
  }

  if (offers.offersEquipment) {
    const ids = [...new Set(selection.equipmentIds ?? [])];
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "equipment")));
    if (ids.length) {
      await db.insert(supplierCatalogItems).values(ids.map((equipmentId) => ({ supplierId, kind: "equipment", equipmentId })));
    }
  } else {
    await db.delete(supplierCatalogItems).where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, "equipment")));
  }
}

export async function addCatalogItem(supplierId: string, kind: "material" | "labour" | "equipment", resourceId: string) {
  if (kind === "material") {
    const [existing] = await db
      .select({ id: supplierCatalogItems.id })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.materialId, resourceId)))
      .limit(1);
    if (!existing) await db.insert(supplierCatalogItems).values({ supplierId, kind, materialId: resourceId });
    return;
  }
  if (kind === "labour") {
    const [existing] = await db
      .select({ id: supplierCatalogItems.id })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.labourCategoryId, resourceId)))
      .limit(1);
    if (!existing) await db.insert(supplierCatalogItems).values({ supplierId, kind, labourCategoryId: resourceId });
    return;
  }
  const [existing] = await db
    .select({ id: supplierCatalogItems.id })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.equipmentId, resourceId)))
    .limit(1);
  if (!existing) await db.insert(supplierCatalogItems).values({ supplierId, kind, equipmentId: resourceId });
}

export async function selectedResourceIds(supplierId: string, kind: "material" | "labour" | "equipment") {
  const rows = await db
    .select({
      materialId: supplierCatalogItems.materialId,
      labourCategoryId: supplierCatalogItems.labourCategoryId,
      equipmentId: supplierCatalogItems.equipmentId,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.supplierId, supplierId), eq(supplierCatalogItems.kind, kind)));
  if (kind === "material") return rows.map((r) => r.materialId).filter((id): id is string => Boolean(id));
  if (kind === "labour") return rows.map((r) => r.labourCategoryId).filter((id): id is string => Boolean(id));
  return rows.map((r) => r.equipmentId).filter((id): id is string => Boolean(id));
}
