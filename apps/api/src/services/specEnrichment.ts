import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  budgetSections,
  lineItems,
  costCompositions,
  compositionMaterialLines,
  materials,
  projectMaterialSpecifications,
} from "../db/schema.js";
import { technicalDescription } from "./technicalDescriptions.js";

export type ProjectSpecRow = {
  materialId: string;
  name: string;
  specification: string | null;
};

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavras-chave por código de item BOQ para encontrar a especificação do projecto. */
const ITEM_SPEC_KEYWORDS: Record<string, string[]> = {
  "6.1": ["mosaico", "pavimento", "ceramico", "cerâmico", "grès"],
  "6.2": ["mosaico", "parede", "revestimento", "wc", "cozinha"],
  "7.1": ["pintura", "exterior", "acrilica", "acrílica"],
  "7.2": ["pintura", "interior", "esmalte", "lavavel", "lavável"],
  "7.3": ["pintura", "tecto", "teto", "interior"],
  "11.1": ["sanita", "autoclismo", "wc"],
  "11.2": ["lavatorio", "lavatório", "lavat"],
  "11.3": ["chuveiro", "duche", "misturadora"],
  "11.4": ["pia", "cozinha", "lava louca", "lava-louça", "inox"],
  "11.5": ["lavandaria", "tanque"],
  "11.6": ["agua", "água", "ppr", "tubagem"],
  "11.7": ["reservatorio", "reservatório", "deposito", "depósito"],
  "10.1": ["impermeabil", "tela", "asfalt"],
  "10.2": ["chapa", "cobertura", "metalica", "metálica"],
};

function matchesKeywords(normalizedName: string, keywords: string[]): boolean {
  return keywords.some((kw) => normalizedName.includes(normalizeName(kw)));
}

export function findProjectSpecForItem(
  itemCode: string | null,
  compositionMaterialNames: string[],
  projectSpecs: ProjectSpecRow[],
): string | null {
  const keywords = itemCode ? ITEM_SPEC_KEYWORDS[itemCode] : undefined;

  for (const spec of projectSpecs) {
    if (!spec.specification?.trim()) continue;
    const norm = normalizeName(spec.name);
    if (keywords && matchesKeywords(norm, keywords)) return spec.specification.trim();
    for (const matName of compositionMaterialNames) {
      const matNorm = normalizeName(matName);
      if (matNorm.includes(norm) || norm.includes(matNorm)) return spec.specification.trim();
    }
  }

  if (keywords) {
    for (const spec of projectSpecs) {
      if (!spec.specification?.trim()) continue;
      if (matchesKeywords(normalizeName(spec.name), keywords)) return spec.specification.trim();
    }
  }

  return null;
}

export async function loadProjectSpecs(projectId: string): Promise<ProjectSpecRow[]> {
  const rows = await db
    .select({
      materialId: projectMaterialSpecifications.materialId,
      name: materials.name,
      specification: projectMaterialSpecifications.specification,
    })
    .from(projectMaterialSpecifications)
    .innerJoin(materials, eq(projectMaterialSpecifications.materialId, materials.id))
    .where(eq(projectMaterialSpecifications.projectId, projectId));
  return rows;
}

async function loadCompositionMaterialNames(compositionIds: string[]): Promise<Map<string, string[]>> {
  if (compositionIds.length === 0) return new Map();
  const lines = await db
    .select({
      compositionId: compositionMaterialLines.compositionId,
      name: materials.name,
      specification: materials.specification,
    })
    .from(compositionMaterialLines)
    .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
    .where(inArray(compositionMaterialLines.compositionId, compositionIds));

  const map = new Map<string, string[]>();
  for (const line of lines) {
    if (!map.has(line.compositionId)) map.set(line.compositionId, []);
    map.get(line.compositionId)!.push(line.name);
  }
  return map;
}

async function loadCompositionMeta(compositionIds: string[]): Promise<Map<string, { description: string | null; measurementCriteria: string | null; executionNotes: string | null }>> {
  if (compositionIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: costCompositions.id,
      description: costCompositions.description,
      measurementCriteria: costCompositions.measurementCriteria,
      executionNotes: costCompositions.executionNotes,
    })
    .from(costCompositions)
    .where(inArray(costCompositions.id, compositionIds));
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadMaterialSpecsForCompositions(compositionIds: string[]): Promise<Map<string, string[]>> {
  if (compositionIds.length === 0) return new Map();
  const lines = await db
    .select({
      compositionId: compositionMaterialLines.compositionId,
      specification: materials.specification,
    })
    .from(compositionMaterialLines)
    .innerJoin(materials, eq(compositionMaterialLines.materialId, materials.id))
    .where(inArray(compositionMaterialLines.compositionId, compositionIds));

  const map = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.specification?.trim()) continue;
    if (!map.has(line.compositionId)) map.set(line.compositionId, []);
    const spec = line.specification.trim();
    if (!map.get(line.compositionId)!.includes(spec)) map.get(line.compositionId)!.push(spec);
  }
  return map;
}

export function buildTechnicalSpecification(input: {
  itemCode: string | null;
  description: string;
  compositionId: string | null;
  compositionMaterialNames: string[];
  compositionMaterialSpecs: string[];
  compositionMeta?: { description: string | null; measurementCriteria: string | null; executionNotes: string | null };
  projectSpec: string | null;
}): string | null {
  const parts: string[] = [];

  if (input.projectSpec) parts.push(input.projectSpec);

  if (!input.projectSpec) {
    for (const spec of input.compositionMaterialSpecs) {
      if (!parts.includes(spec)) parts.push(spec);
    }
  }

  const meta = input.compositionMeta;
  if (meta?.description?.trim() && !parts.some((p) => p.includes(meta.description!.trim().slice(0, 40)))) {
    parts.push(meta.description.trim());
  }
  if (meta?.measurementCriteria?.trim()) parts.push(`Medição: ${meta.measurementCriteria.trim()}`);
  if (meta?.executionNotes?.trim()) parts.push(`Execução: ${meta.executionNotes.trim()}`);

  const legacy = technicalDescription(input.description);
  if (legacy !== input.description && !parts.some((p) => p.slice(0, 30) === legacy.slice(0, 30))) {
    parts.unshift(legacy);
  }

  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export async function enrichLineItemTechnicalSpecs(
  flatItems: Array<typeof lineItems.$inferSelect>,
  projectId: string,
): Promise<Map<string, string | null>> {
  const projectSpecs = await loadProjectSpecs(projectId);
  const compositionIds = [...new Set(flatItems.map((i) => i.compositionId).filter(Boolean))] as string[];
  const materialNamesByComp = await loadCompositionMaterialNames(compositionIds);
  const materialSpecsByComp = await loadMaterialSpecsForCompositions(compositionIds);
  const metaByComp = await loadCompositionMeta(compositionIds);

  const result = new Map<string, string | null>();
  for (const item of flatItems) {
    if (item.kind !== "item") {
      result.set(item.id, null);
      continue;
    }
    const compId = item.compositionId;
    const materialNames = compId ? materialNamesByComp.get(compId) ?? [] : [];
    const projectSpec = findProjectSpecForItem(item.code, materialNames, projectSpecs);
    const spec = buildTechnicalSpecification({
      itemCode: item.code,
      description: item.description,
      compositionId: compId,
      compositionMaterialNames: materialNames,
      compositionMaterialSpecs: compId ? materialSpecsByComp.get(compId) ?? [] : [],
      compositionMeta: compId ? metaByComp.get(compId) : undefined,
      projectSpec,
    });
    result.set(item.id, spec);
  }
  return result;
}

/** Persiste especificações técnicas enriquecidas nas descrições dos itens (para exportação/PDF). */
export async function applyProjectSpecificationsToDocument(documentId: string, projectId: string): Promise<{ updated: number }> {
  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) return { updated: 0 };

  const items = await db.select().from(lineItems).where(inArray(lineItems.sectionId, sectionIds));
  const specs = await enrichLineItemTechnicalSpecs(items, projectId);

  let updated = 0;
  for (const item of items) {
    if (item.kind !== "item") continue;
    const tech = specs.get(item.id);
    if (!tech) continue;
    const base = item.description.split("\n\n— Especificação técnica —")[0].trim();
    const enriched = `${base}\n\n— Especificação técnica —\n${tech}`;
    if (enriched !== item.description) {
      await db.update(lineItems).set({ description: enriched }).where(eq(lineItems.id, item.id));
      updated += 1;
    }
  }
  return { updated };
}

export async function getProjectIdForDocument(documentId: string): Promise<string | null> {
  const [doc] = await db.select({ projectId: budgetDocuments.projectId }).from(budgetDocuments).where(eq(budgetDocuments.id, documentId)).limit(1);
  return doc?.projectId ?? null;
}
