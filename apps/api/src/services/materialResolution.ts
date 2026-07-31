import { eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { materials } from "../db/schema.js";
import type { Unit } from "@sigo/shared";

// Normalização usada em todo o sistema para decidir se dois materiais são "o mesmo" apesar de
// acentuação/maiúsculas diferentes — a mesma regra usada ao clonar materiais no catálogo e ao
// resolver especificações técnicas do projecto, para nunca duplicar silenciosamente um material
// que já existe só porque o nome foi escrito de forma ligeiramente diferente.
export function normalizeMaterialName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt");
}

// Encontra o material visível pela empresa (próprio ou partilhado) cujo nome normalizado
// coincide; quando não existe, cria um novo material da empresa com custo zero e a origem
// assinalada como "por cotar" — nunca inventa um preço, só sugere a nomenclatura e deixa a
// cotação real para o fluxo normal do catálogo/fornecedores.
export async function resolveOrCreateMaterialByName(
  companyId: string,
  input: { name: string; unit: Unit; category?: string; specification?: string; sourceLabel?: string },
) {
  const visible = await db
    .select()
    .from(materials)
    .where(or(eq(materials.companyId, companyId), isNull(materials.companyId)));
  const normalized = normalizeMaterialName(input.name);
  const existing = visible.find((material) => normalizeMaterialName(material.name) === normalized);
  if (existing) return { material: existing, created: false };

  const [created] = await db
    .insert(materials)
    .values({
      companyId,
      name: input.name.trim(),
      category: input.category ?? "Especificado no projecto",
      specification: input.specification?.trim() || null,
      unit: input.unit,
      baseUnitCost: "0",
      currency: "MZN",
      priceSourceName: input.sourceLabel ?? "Especificação técnica do projecto",
      sourceReference: "Preço pendente de cotação",
    })
    .returning();
  return { material: created, created: true };
}
