import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { materials, supplierMaterialPrices, suppliers } from "../db/schema.js";

export const SIGO_PRICES_SUPPLIER_NAME = "SIGO Preços";
export const SIGO_PRICES_REVIEW_DATE = "2026-08-03";
export const SIGO_PRICES_NOTES = [
  "Fornecedor SIGO (catálogo nacional), sem IVA.",
  "Base inicial: INE Moçambique e preços públicos de fornecedores locais.",
  "Os preços podem ser editados; novos materiais do catálogo são acrescentados automaticamente.",
].join(" ");

export function isSigoPricesSupplier(supplier: { name: string }) {
  return supplier.name.trim().toLocaleLowerCase("pt") === SIGO_PRICES_SUPPLIER_NAME.toLocaleLowerCase("pt");
}

/**
 * Garante o fornecedor «SIGO Preços» e preenche cotações em falta para cada empresa.
 * Materiais próprios da empresa substituem globais com o mesmo nome.
 * Preços já existentes NÃO são sobrescritos — a empresa pode editá-los livremente.
 * Só materiais novos (ainda sem linha) recebem o preço base do catálogo.
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

  for (const material of visible) {
    if (currentByMaterial.has(material.id)) continue;
    const unitCost = (Number(material.baseUnitCost) * Number(material.importFactor)).toFixed(2);
    await db.insert(supplierMaterialPrices).values({
      supplierId: supplier.id,
      materialId: material.id,
      zoneId: null,
      unitCost,
      currency: material.currency,
    });
    created += 1;
  }

  return { supplier, materials: visible.length, created, updated: 0 };
}
