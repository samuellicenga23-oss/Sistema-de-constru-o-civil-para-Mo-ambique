import { and, eq, isNull, or } from "drizzle-orm";
import { normalizeUnit, type Unit } from "@sigo/shared";
import { db } from "../db/index.js";
import {
  compositionEquipmentLines,
  compositionLabourLines,
  compositionMaterialLines,
  costCompositions,
  equipment,
  labourCategories,
  materials,
} from "../db/schema.js";
import { computeCompositionUnitCost } from "./costEngine.js";
import { mapDescriptionToSigoComposition, mentionsSteel } from "./sigoCompositionMap.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ImportCompositionTarget = {
  code: string;
  description: string;
  unit: Unit | string;
  preferredCompositionName?: string | null;
  preferredCompositionId?: string | null;
};

export type ResolvedImportComposition = {
  compositionId: string;
  compositionName: string;
  unitPrice: number;
  created: boolean;
  matchedExisting: boolean;
};

export type ImportResourcesCache = {
  current: Awaited<ReturnType<typeof loadScopedResources>> | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function scoreText(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return 0.88;
  const ta = new Set(na.split(/\s+/).filter((t) => t.length > 2));
  const tb = new Set(nb.split(/\s+/).filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

type ChapterTemplate = {
  labour: Array<[string, number]>;
  materials: Array<[string, number, number?]>; // name, qty, waste%
  equipment?: Array<[string, number]>;
};

/** Templates por capítulo quando não há composição SIGO — com materiais reais. */
function chapterTemplate(unit: string, description: string): ChapterTemplate {
  const d = normalizeText(description);
  const u = normalizeUnit(unit, "un");

  // Portas / janelas / ferragens antes de canalização (evitar "sanitária" → tubos).
  if (/\bportas?\b/.test(d) && !/portao/.test(d)) {
    return {
      labour: [["Carpinteiro B", 2.0], ["Servente", 0.5]],
      materials: [["Porta interior de madeira (kit completo)", 1], ["Ferragens de porta (fechadura, dobradiças)", 1]],
    };
  }
  if (/\bjanelas?\b|caixilh/.test(d)) {
    return {
      labour: [["Serralheiro", 0.6], ["Vidraceiro", 0.35], ["Servente", 0.25]],
      materials: [["Janela de alumínio com vidro incolor (kit)", 1], ["Espuma expansiva", 0.05]],
    };
  }
  if (/fechadura|dobradic|tranqueta|ferrag/.test(d)) {
    return {
      labour: [["Carpinteiro B", 0.5]],
      materials: [["Ferragens de porta (fechadura, dobradiças)", 1]],
    };
  }
  if (/disjuntor|caixa\s+de\s+coluna|trifas/.test(d)) {
    return {
      labour: [["Electricista", 2.0]],
      materials: [["Quadro eléctrico parcial", 1], ["Disjuntores e acessórios eléctricos", 1]],
    };
  }
  if (/electric|eletrico|cabo|tomada|interruptor|luminar|quadro|eletroduto|anelado/.test(d)) {
    if (u === "un") {
      return {
        labour: [["Electricista", 1.2], ["Servente", 0.4]],
        materials: [["Cabo eléctrico 2.5mm²", 8], ["Tomada/interruptor", 1], ["Caixa de aparelhagem embutida", 1]],
      };
    }
    return {
      labour: [["Electricista", 0.4], ["Servente", 0.3]],
      materials: [["Eletroduto PVC Ø20mm", 1.05], ["Cabo eléctrico 2.5mm²", 1.05], ["Caixa de derivação", 0.1]],
    };
  }
  if (/toalheiro|acessorios?\s+wc|espelho/.test(d)) {
    return {
      labour: [["Canalizador", 0.8]],
      materials: [["Acessórios WC (toalheiro, porta-papel)", 1], ["Espelho para lavatório", 1]],
    };
  }
  if (
    /canaliz|tubo|esgoto|torneira|sanita|lavatorio|autoclismo|ppr|upvc|pead/.test(d) ||
    (/\bagua\b/.test(d) && !/porta|janela/.test(d))
  ) {
    if (u === "un") {
      return {
        labour: [["Canalizador", 1.5], ["Servente", 0.5]],
        materials: [["Tubo PPR 20mm (água)", 6], ["Acessórios de canalização (água)", 1], ["Torneira/registo", 1]],
      };
    }
    return {
      labour: [["Canalizador", 0.45], ["Servente", 0.45]],
      materials: [["Tubo uPVC Ø110mm", 1.05], ["Acessórios uPVC (colarinhos, curvas, sifões)", 0.3]],
    };
  }
  if (/pintura|tinta|verniz|esmalte|cinacryl/.test(d)) {
    const exterior = /exterior|acril/.test(d);
    return {
      labour: [["Pintor", 0.4], ["Servente", 0.2]],
      materials: [[exterior ? "Tinta acrílica exterior" : "Tinta esmalte aquoso interior", exterior ? 0.02 : 0.018]],
    };
  }
  if (mentionsSteel(d) || (u === "kg" && /ferro|var/.test(d))) {
    return {
      labour: [["Armador de Ferro", u === "kg" ? 0.1 : 0.4], ["Servente", u === "kg" ? 0.1 : 0.3]],
      materials: [["Aço A400", u === "kg" ? 1.05 : 15], ["Arame de amarração", u === "kg" ? 0.02 : 0.3]],
    };
  }
  if (/cofrag|madeira|carpint/.test(d)) {
    return {
      labour: [["Carpinteiro B", 1.0], ["Servente", 0.8]],
      materials: [["Madeira de cofragem", 0.035], ["Prego", 0.15]],
    };
  }
  if (/escav|aterro|reaterro|terrap|compact|cabouco/.test(d)) {
    return {
      labour: [["Servente", u === "m3" ? 2.5 : 0.8]],
      materials: u === "m3" ? [["Água", 0.05]] : [],
      equipment: /compact|aterro|reaterro/.test(d) ? [["Placa compactadora", 0.5]] : undefined,
    };
  }
  if (/alvenaria|bloco|tijolo/.test(d)) {
    const b15 = /15|150/.test(d);
    return {
      labour: [["Pedreiro A", 1.0], ["Servente", 1.5]],
      materials: [
        [b15 ? "Bloco de cimento 15x20x40" : "Bloco de cimento 20x20x40", 12.5],
        ["Cimento (saco 50kg)", 0.28],
        ["Areia grossa", 0.03],
        ["Água", 0.01],
      ],
    };
  }
  if (/reboco|betonilha|estanh/.test(d)) {
    return {
      labour: [["Pedreiro A", 0.8], ["Servente", 1.0]],
      materials: [["Cimento (saco 50kg)", 0.18], ["Areia fina", 0.02], ["Água", 0.008]],
    };
  }
  if (/mosaico|azulej|ceramic|porcelanato/.test(d)) {
    return {
      labour: [["Pedreiro A", 1.0], ["Servente", 1.0]],
      materials: [["Mosaico cerâmico", 1.05], ["Cimento cola", 4], ["Cruzetas para juntas", 20]],
    };
  }
  if (/betao|betão|b15|b20|b25|b30|viga|pilar|sapata|laje/.test(d)) {
    return {
      labour: [["Pedreiro A", 2.5], ["Servente", 5.0]],
      materials: [
        ["Cimento (saco 50kg)", 7],
        ["Areia grossa", 0.5],
        ["Brita 3/4", 0.8],
        ["Água", 0.2],
      ],
      equipment: [["Betoneira", 1.0]],
    };
  }
  if (/impermeabil|tela\s*asfalt|betumin/.test(d)) {
    return {
      labour: [["Servente", 0.3], ["Pedreiro A", 0.2]],
      materials: [["Tela asfáltica impermeabilizante", 1.1], ["Primário betuminoso", 1.0]],
    };
  }
  if (/gesso|tecto\s*falso|pladur/.test(d)) {
    return {
      labour: [["Carpinteiro de Tectos (Gesseiro)", 0.6], ["Servente", 0.3]],
      materials: [["Placa de gesso cartonado", 1.05], ["Perfilaria metálica para tecto falso", 1.1]],
    };
  }
  if (/chapa|cobertura|telha/.test(d)) {
    return {
      labour: [["Carpinteiro B", 0.5], ["Servente", 0.5]],
      materials: [["Chapa metálica ondulada para cobertura", 1.1], ["Vigamento de madeira para cobertura", 0.6], ["Prego", 0.1]],
    };
  }
  if (/anti-?termit|carbolim|xilofag/.test(d)) {
    return {
      labour: [["Servente", 0.15]],
      materials: [["Produto anti-térmitas", 0.02], ["Água", 0.005]],
    };
  }

  switch (u) {
    case "m3":
      return {
        labour: [["Pedreiro A", 2.0], ["Servente", 3.0]],
        materials: [["Cimento (saco 50kg)", 5], ["Areia grossa", 0.4], ["Brita 3/4", 0.6], ["Água", 0.15]],
        equipment: [["Betoneira", 0.8]],
      };
    case "m2":
      return {
        labour: [["Pedreiro A", 0.6], ["Servente", 0.8]],
        materials: [["Cimento (saco 50kg)", 0.15], ["Areia fina", 0.02], ["Água", 0.008]],
      };
    case "ml":
    case "m":
      return {
        labour: [["Servente", 0.25], ["Pedreiro A", 0.15]],
        materials: [["Cimento (saco 50kg)", 0.05], ["Areia grossa", 0.01]],
      };
    case "kg":
      return {
        labour: [["Servente", 0.08]],
        materials: [["Aço A400", 1.05]],
      };
    case "vg":
      return {
        labour: [["Encarregado", 2.0], ["Servente", 8.0]],
        materials: [],
      };
    case "h":
      return { labour: [["Servente", 1.0]], materials: [] };
    default:
      return {
        labour: [["Pedreiro A", 1.0], ["Servente", 1.0]],
        materials: [["Cimento (saco 50kg)", 0.1], ["Areia grossa", 0.02]],
      };
  }
}

async function loadScopedResources(tx: Tx, companyId: string | null) {
  const companyFilter = <T extends { companyId: any }>(col: T["companyId"]) =>
    companyId ? or(isNull(col), eq(col, companyId)) : isNull(col);

  const [comps, labour, mats, equip] = await Promise.all([
    tx
      .select({
        id: costCompositions.id,
        name: costCompositions.name,
        companyId: costCompositions.companyId,
        outputUnit: costCompositions.outputUnit,
        category: costCompositions.category,
      })
      .from(costCompositions)
      .where(companyFilter(costCompositions.companyId)),
    tx
      .select({ id: labourCategories.id, name: labourCategories.name, companyId: labourCategories.companyId })
      .from(labourCategories)
      .where(companyFilter(labourCategories.companyId)),
    tx
      .select({ id: materials.id, name: materials.name, companyId: materials.companyId })
      .from(materials)
      .where(companyFilter(materials.companyId)),
    tx
      .select({ id: equipment.id, name: equipment.name, companyId: equipment.companyId })
      .from(equipment)
      .where(companyFilter(equipment.companyId)),
  ]);

  function preferCompany<T extends { name: string; companyId: string | null; id: string }>(rows: T[]) {
    const map = new Map<string, T>();
    for (const row of rows) {
      const key = normalizeText(row.name);
      const cur = map.get(key);
      if (!cur || (cur.companyId === null && row.companyId !== null)) map.set(key, row);
    }
    return map;
  }

  return {
    compositions: comps,
    labourByName: preferCompany(labour),
    materialsByName: preferCompany(mats),
    equipmentByName: preferCompany(equip),
  };
}

function isReferenceCategory(category: string | null | undefined): boolean {
  return normalizeText(category || "") === normalizeText("Biblioteca de referência");
}

function pickBestComposition(
  compositions: Array<{
    id: string;
    name: string;
    companyId: string | null;
    outputUnit: string;
    category?: string | null;
  }>,
  target: ImportCompositionTarget,
): { id: string; name: string; score: number } | null {
  if (target.preferredCompositionId) {
    const hit = compositions.find((c) => c.id === target.preferredCompositionId);
    if (hit) return { id: hit.id, name: hit.name, score: 1 };
  }
  if (target.preferredCompositionName) {
    const want = normalizeText(target.preferredCompositionName);
    const exact = compositions.find((c) => normalizeText(c.name) === want && !isReferenceCategory(c.category));
    if (exact) return { id: exact.id, name: exact.name, score: 1 };
    const anyExact = compositions.find((c) => normalizeText(c.name) === want);
    if (anyExact) return { id: anyExact.id, name: anyExact.name, score: 1 };
  }

  // Mapeamento SIGO por regras (preferir biblioteca clássica).
  const mapped = mapDescriptionToSigoComposition(target.description, target.unit);
  if (mapped) {
    const want = normalizeText(mapped.compositionName);
    const hit = compositions.find((c) => normalizeText(c.name) === want && !isReferenceCategory(c.category));
    if (hit) return { id: hit.id, name: hit.name, score: mapped.confidence };
  }

  let best: {
    id: string;
    name: string;
    score: number;
    companyId: string | null;
    reference: boolean;
  } | null = null;
  const unit = normalizeUnit(target.unit, "un");
  for (const c of compositions) {
    if (isReferenceCategory(c.category)) continue; // nunca fuzzy-match em stubs de referência
    let score = scoreText(target.description, c.name);
    if (c.outputUnit === unit) score += 0.05;
    const reference = false;
    if (
      score >= 0.72 &&
      (!best ||
        score > best.score ||
        (score === best.score && c.companyId && !best.companyId) ||
        (score === best.score && !reference && best.reference))
    ) {
      best = { id: c.id, name: c.name, score, companyId: c.companyId, reference };
    }
  }
  return best ? { id: best.id, name: best.name, score: best.score } : null;
}

function compositionNameForImport(target: ImportCompositionTarget): string {
  const base = (target.description || target.code).replace(/\s+/g, " ").trim();
  const named = base.length > 8 ? base : `${target.code} — ${base}`;
  return named.slice(0, 200);
}

async function createCompositionFromHints(
  tx: Tx,
  companyId: string | null,
  target: ImportCompositionTarget,
  resources: Awaited<ReturnType<typeof loadScopedResources>>,
  options: { category?: string; sourceName?: string } = {},
): Promise<{ id: string; name: string }> {
  const name = compositionNameForImport(target);
  const unit = normalizeUnit(target.unit, "un");
  const desc = target.description || name;
  const category = options.category ?? (companyId ? "Importados" : "Biblioteca de referência");
  const sourceName = options.sourceName ?? (companyId ? "Importação de mapa de quantidades" : "Mapas de referência SIGO");

  const sameName = resources.compositions.find(
    (c) =>
      (companyId ? c.companyId === companyId : c.companyId === null) &&
      normalizeText(c.name) === normalizeText(name),
  );
  if (sameName) return { id: sameName.id, name: sameName.name };

  const tmpl = chapterTemplate(unit, desc);
  const labourLines: Array<{ labourCategoryId: string; qtyPerUnit: string }> = [];
  for (const [labourName, qty] of tmpl.labour) {
    const row = resources.labourByName.get(normalizeText(labourName));
    if (row) labourLines.push({ labourCategoryId: row.id, qtyPerUnit: qty.toFixed(4) });
  }
  if (!labourLines.length) {
    const servente = resources.labourByName.get(normalizeText("Servente"));
    if (servente) labourLines.push({ labourCategoryId: servente.id, qtyPerUnit: "1.0000" });
  }

  const materialLines: Array<{ materialId: string; qtyPerUnit: string; wastePct: string }> = [];
  const seenMats = new Set<string>();
  for (const [matName, qty, waste] of tmpl.materials) {
    const key = normalizeText(matName);
    if (seenMats.has(key)) continue;
    const row = resources.materialsByName.get(key);
    if (!row) continue;
    seenMats.add(key);
    materialLines.push({
      materialId: row.id,
      qtyPerUnit: qty.toFixed(4),
      wastePct: String(waste ?? 5),
    });
  }

  const equipLines: Array<{ equipmentId: string; qtyPerUnit: string }> = [];
  for (const [eqName, qty] of tmpl.equipment || []) {
    const row = resources.equipmentByName.get(normalizeText(eqName));
    if (row) equipLines.push({ equipmentId: row.id, qtyPerUnit: qty.toFixed(4) });
  }

  const [created] = await tx
    .insert(costCompositions)
    .values({
      companyId,
      code: target.code.slice(0, 50),
      name,
      category,
      description: companyId
        ? `Composição gerada automaticamente na importação do item ${target.code}. Reveja rendimentos e insumos.`
        : `Composição de referência gerada a partir de mapas de quantidades reais (item ${target.code}).`,
      outputUnit: unit,
      currency: "MZN",
      auxiliaryCostPct: "0",
      indirectCostPct: "0",
      profitMarginPct: "0",
      sourceName,
      sourceReference: target.code,
      isActive: true,
      version: 1,
    })
    .returning();

  if (labourLines.length) {
    await tx.insert(compositionLabourLines).values(
      labourLines.map((line) => ({
        compositionId: created.id,
        labourCategoryId: line.labourCategoryId,
        qtyPerUnit: line.qtyPerUnit,
        notes: "Template de capítulo — ajustar se necessário",
      })),
    );
  }
  if (materialLines.length) {
    await tx.insert(compositionMaterialLines).values(
      materialLines.map((line) => ({
        compositionId: created.id,
        materialId: line.materialId,
        qtyPerUnit: line.qtyPerUnit,
        wastePct: line.wastePct,
        notes: "Template de capítulo — ajustar se necessário",
      })),
    );
  }
  if (equipLines.length) {
    await tx.insert(compositionEquipmentLines).values(
      equipLines.map((line) => ({
        compositionId: created.id,
        equipmentId: line.equipmentId,
        qtyPerUnit: line.qtyPerUnit,
        notes: "Template de capítulo — ajustar se necessário",
      })),
    );
  }

  resources.compositions.push({
    id: created.id,
    name: created.name,
    companyId,
    outputUnit: unit,
    category,
  });

  return { id: created.id, name: created.name };
}

/**
 * Resolve composição existente (template/nome/similaridade) ou cria uma nova
 * composição da empresa com mão-de-obra + insumos por template de capítulo.
 */
export async function resolveOrCreateCompositionForImport(
  tx: Tx,
  companyId: string | null,
  target: ImportCompositionTarget,
  zoneId: string | null,
  cache: Map<string, ResolvedImportComposition>,
  resourcesCache?: ImportResourcesCache,
  options?: { category?: string; sourceName?: string; forceCreate?: boolean },
): Promise<ResolvedImportComposition> {
  const mapped = mapDescriptionToSigoComposition(target.description, target.unit);
  const preferredName = target.preferredCompositionName || mapped?.compositionName || null;
  const enriched: ImportCompositionTarget = {
    ...target,
    preferredCompositionName: preferredName,
  };

  const cacheKey = `${companyId ?? "global"}|${normalizeText(preferredName || "")}|${normalizeText(target.code)}|${normalizeText(target.description).slice(0, 80)}|${target.unit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (!resourcesCache) resourcesCache = { current: null };
  if (!resourcesCache.current) resourcesCache.current = await loadScopedResources(tx, companyId);
  const resources = resourcesCache.current;
  const matched = options?.forceCreate ? null : pickBestComposition(resources.compositions, enriched);

  let compositionId: string;
  let compositionName: string;
  let created = false;
  let matchedExisting = false;

  if (matched) {
    compositionId = matched.id;
    compositionName = matched.name;
    matchedExisting = true;
  } else {
    const createdComp = await createCompositionFromHints(tx, companyId, target, resources, {
      category: options?.category,
      sourceName: options?.sourceName,
    });
    compositionId = createdComp.id;
    compositionName = createdComp.name;
    created = true;
  }

  const breakdown = await computeCompositionUnitCost(compositionId, companyId, zoneId);
  const resolved: ResolvedImportComposition = {
    compositionId,
    compositionName,
    unitPrice: Number(breakdown.unitCost) || 0,
    created,
    matchedExisting,
  };
  cache.set(cacheKey, resolved);
  return resolved;
}

/** Variante fora de transação (preview). */
export async function previewCompositionForImport(
  companyId: string,
  target: ImportCompositionTarget,
): Promise<{ compositionName: string | null; compositionId: string | null; matched: boolean }> {
  const resources = await loadScopedResources(db as unknown as Tx, companyId);
  const mapped = mapDescriptionToSigoComposition(target.description, target.unit);
  const matched = pickBestComposition(resources.compositions, {
    ...target,
    preferredCompositionName: target.preferredCompositionName || mapped?.compositionName,
    preferredCompositionId: target.preferredCompositionId,
  });
  if (matched) {
    return { compositionName: matched.name, compositionId: matched.id, matched: true };
  }
  return {
    compositionName: compositionNameForImport(target),
    compositionId: null,
    matched: false,
  };
}
