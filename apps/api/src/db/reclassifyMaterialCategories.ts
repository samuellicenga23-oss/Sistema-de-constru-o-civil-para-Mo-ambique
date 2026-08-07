import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { materials } from "../db/schema.js";
import { resolveMaterialCategory } from "../services/materialCategories.js";

/** Reclassifica todos os materiais (nacional + empresa) que estão em Outros ou etiquetas legadas. */
export async function reclassifyAllMaterialCategories() {
  const rows = await db
    .select({
      id: materials.id,
      name: materials.name,
      category: materials.category,
      specification: materials.specification,
    })
    .from(materials);

  let updated = 0;
  for (const row of rows) {
    const next = resolveMaterialCategory(row.name, row.category, row.specification);
    if (next === row.category) continue;
    await db.update(materials).set({ category: next, updatedAt: new Date() }).where(eq(materials.id, row.id));
    updated += 1;
  }
  console.log(`categorias de materiais: ${updated} actualizadas (em ${rows.length} materiais)`);
  return updated;
}
