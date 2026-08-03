import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { materials, supplierMaterialPrices, suppliers } from "../db/schema.js";

export const SIGO_PRICES_SUPPLIER_NAME = "SIGO Preços";
export const SIGO_PRICES_REVIEW_DATE = "2026-08-03";
export const SIGO_PRICES_NOTES = [
  "Referência nacional SIGO, sem IVA.",
  "Base: INE Moçambique e preços públicos de fornecedores locais.",
  "Confirme a cotação e o transporte antes de comprar.",
].join(" ");

export function isSigoPricesSupplier(supplier: { name: string }) {
  return supplier.name.trim().toLocaleLowerCase("pt") === SIGO_PRICES_SUPPLIER_NAME.toLocaleLowerCase("pt");
}

/**
 * Garante uma referência de preço completa para cada empresa.
 * Os materiais próprios da empresa substituem materiais globais com o mesmo nome.
 * As linhas são apenas uma base comparativa; fornecedores reais continuam a ter prioridade
 * quando apresentam uma cotação mais baixa ou específica para a zona.
 */
export async function syncSigoPricesForCompany(companyId: string) {
  let [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), eq(suppliers.name, SIGO_PRICES_SUPPLIER_NAME)))
    .limit(1);

  if (!supplier) {
    [supplier] = await db
      .insert(suppliers)
      .values({
        companyId,
        name: SIGO_PRICES_SUPPLIER_NAME,
        location: "Moçambique",
        notes: SIGO_PRICES_NOTES,
      })
      .returning();
  } else if (supplier.notes !== SIGO_PRICES_NOTES || supplier.location !== "Moçambique") {
    [supplier] = await db
      .update(suppliers)
      .set({ location: "Moçambique", notes: SIGO_PRICES_NOTES })
      .where(eq(suppliers.id, supplier.id))
      .returning();
  }

  const available = await db
    .select()
    .from(materials)
    .where(and(or(isNull(materials.companyId), eq(materials.companyId, companyId)), eq(materials.isActive, true)));

  const visibleByName = new Map<string, (typeof available)[number]>();
  for (const material of available.filter((item) => item.companyId == null)) {
    visibleByName.set(material.name.trim().toLocaleLowerCase("pt"), material);
  }
  for (const material of available.filter((item) => item.companyId === companyId)) {
    visibleByName.set(material.name.trim().toLocaleLowerCase("pt"), material);
  }
  const visible = [...visibleByName.values()];

  const current = await db
    .select()
    .from(supplierMaterialPrices)
    .where(and(eq(supplierMaterialPrices.supplierId, supplier.id), isNull(supplierMaterialPrices.zoneId)));
  const currentByMaterial = new Map(current.map((price) => [price.materialId, price]));
  let created = 0;
  let updated = 0;

  for (const material of visible) {
    const unitCost = (Number(material.baseUnitCost) * Number(material.importFactor)).toFixed(2);
    const existing = currentByMaterial.get(material.id);
    if (!existing) {
      await db.insert(supplierMaterialPrices).values({
        supplierId: supplier.id,
        materialId: material.id,
        zoneId: null,
        unitCost,
        currency: material.currency,
      });
      created += 1;
    } else if (Number(existing.unitCost).toFixed(2) !== unitCost || existing.currency !== material.currency) {
      await db
        .update(supplierMaterialPrices)
        .set({ unitCost, currency: material.currency })
        .where(eq(supplierMaterialPrices.id, existing.id));
      updated += 1;
    }
  }

  return { supplier, materials: visible.length, created, updated };
}
