import { eq, isNull, or, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems, costCompositions, workItemTemplates } from "../db/schema.js";
import { computeCompositionUnitCostV2 } from "./costEngineV2.js";
import { fixedSigo, type Unit } from "@sigo/shared";

// Estrutura padrão de um Mapa de Quantidades moçambicano (capítulos e trabalhos correntes,
// derivada dos ficheiros reais analisados: Dr Castro, Centro de Excelência TB, UEM).
// Cada item pode referenciar uma composição do catálogo pelo nome — o preço unitário é
// calculado no momento da geração; quantidades começam a 0 para serem preenchidas por
// medições dimensionais (Nº × Comp. × Larg. × Alt.) ou manualmente.
export type TemplateItem = { code: string; description: string; unit: Unit; composition?: string; compositionId?: string | null };
export type TemplateChapter = {
  code: string;
  name: string;
  discipline?: string;
  detectionTags?: string[];
  requiresTagMatch?: boolean;
  version?: number;
  companyId?: string | null;
  items: TemplateItem[];
};

export type AdaptivePlantContext = {
  disciplines: string[];
  hasRooms: boolean;
  hasStructuralElements: boolean;
  detectedTerms?: string[];
};

export type BoqTemplateSelection = {
  mode: "adaptativo" | "padrao";
  chapters: TemplateChapter[];
  detectedDisciplines: string[];
};

export const STANDARD_CHAPTERS: TemplateChapter[] = [
  {
    code: "1",
    name: "TRABALHOS PRELIMINARES",
    items: [
      { code: "1.1", description: "Limpeza e regularização do terreno", unit: "m2", composition: "Remoção e limpeza do terreno até 20cm de profundidade" },
      { code: "1.2", description: "Implantação e marcação da obra", unit: "ml", composition: "Implantação da obra / montagem de cangalho" },
      { code: "1.3", description: "Tratamento anti-térmitas do solo", unit: "m2", composition: "Tratamento anti-térmitas do solo" },
    ],
  },
  {
    code: "2",
    name: "MOVIMENTOS DE TERRA",
    items: [
      { code: "2.1", description: "Escavação de fundações", unit: "m3", composition: "Escavação manual em fundações (incl. baldeação)" },
      { code: "2.2", description: "Reaterro compactado com solo da escavação", unit: "m3", composition: "Reaterro compactado com solos da escavação" },
      { code: "2.3", description: "Aterro compactado com solo de empréstimo", unit: "m3", composition: "Aterro com terras de empréstimo compactado" },
      { code: "2.4", description: "Enrocamento em fundações e pavimentos", unit: "m3", composition: "Enrocamento com pedra em fundações/pavimentos" },
      { code: "2.5", description: "Membrana de polietileno sob pavimento", unit: "m2", composition: "Membrana de polietileno em caixas de pavimento" },
    ],
  },
  {
    code: "3",
    name: "BETÕES, AÇOS E COFRAGENS",
    items: [
      { code: "3.1", description: "Betão de limpeza B15 em fundações e sapatas", unit: "m3", composition: "Betão B15 (betão de limpeza)" },
      { code: "3.2", description: "Betão B25 em sapatas", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.3", description: "Betão estrutural B25 em pilares", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.4", description: "Betão B25 em vigas e lintéis", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.5", description: "Betão estrutural B25 em lajes", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.6", description: "Aço A400 aplicado", unit: "kg", composition: "Aço A400 aplicado (corte, dobragem e amarração)" },
      { code: "3.7", description: "Malhasol AQ38 aplicado", unit: "m2", composition: "Malhasol AQ38 aplicado" },
      { code: "3.8", description: "Cofragem de elementos estruturais", unit: "m2", composition: "Cofragem e descofragem de madeira" },
    ],
  },
  {
    code: "4",
    name: "ALVENARIAS",
    items: [
      { code: "4.1", description: "Alvenaria de bloco 20 cm", unit: "m2", composition: "Alvenaria de bloco 20 (400x200x200mm)" },
      { code: "4.2", description: "Alvenaria de bloco 15 cm", unit: "m2", composition: "Alvenaria de bloco 15 (400x200x150mm)" },
    ],
  },
  {
    code: "5",
    name: "BETONILHAS E REBOCOS",
    items: [
      { code: "5.1", description: "Betonilha de regularização", unit: "m2", composition: "Betonilha de regularização" },
      { code: "5.2", description: "Reboco interior estanhado", unit: "m2", composition: "Reboco interior estanhado" },
      { code: "5.3", description: "Reboco exterior hidrófugo", unit: "m2", composition: "Reboco exterior hidrófugo" },
    ],
  },
  {
    code: "6",
    name: "REVESTIMENTO DE PAVIMENTOS E PAREDES",
    items: [
      { code: "6.1", description: "Mosaico cerâmico em pavimentos", unit: "m2", composition: "Assentamento de mosaico cerâmico" },
      { code: "6.2", description: "Mosaico cerâmico em paredes", unit: "m2", composition: "Assentamento de mosaico cerâmico" },
    ],
  },
  {
    code: "7",
    name: "PINTURAS",
    items: [
      { code: "7.1", description: "Pintura acrílica exterior", unit: "m2", composition: "Pintura acrílica exterior (2 demãos + primário)" },
      { code: "7.2", description: "Pintura lavável interior", unit: "m2", composition: "Pintura esmalte aquoso interior (2 demãos + primário)" },
      { code: "7.3", description: "Pintura de tectos", unit: "m2", composition: "Pintura esmalte aquoso interior (2 demãos + primário)" },
    ],
  },
  {
    code: "8",
    name: "DRENAGEM DE ESGOTOS",
    items: [
      { code: "8.1", description: "Tubagem de esgoto uPVC Ø110 mm", unit: "ml", composition: "Tubagem uPVC Ø110mm assente (esgotos)" },
      { code: "8.2", description: "Tubagem de esgoto uPVC Ø40 mm", unit: "ml", composition: "Tubagem uPVC Ø40mm assente (esgotos)" },
      { code: "8.3", description: "Caixa de visita de esgotos", unit: "un", composition: "Caixa de visita de esgotos montada" },
    ],
  },
  {
    code: "9",
    name: "DRENAGEM DE ÁGUAS PLUVIAIS",
    items: [
      { code: "9.1", description: "Tubo de queda PVC Ø80 mm", unit: "m", composition: "Tubo de queda PVC Ø80mm montado (pluviais)" },
    ],
  },
  {
    code: "10",
    name: "COBERTURA",
    items: [
      { code: "10.1", description: "Impermeabilização da cobertura", unit: "m2", composition: "Impermeabilização de laje de cobertura (tela asfáltica)" },
      { code: "10.2", description: "Cobertura em chapa metálica", unit: "m2", composition: "Cobertura em chapa metálica ondulada" },
      { code: "10.3", description: "Cumeeira e remates de cobertura", unit: "ml", composition: "Cumeeira / remate de cobertura" },
    ],
  },
  {
    code: "11",
    name: "INSTALAÇÃO HIDRÁULICA",
    items: [
      { code: "11.1", description: "Sanita completa com autoclismo", unit: "un", composition: "Sanita completa montada (com autoclismo)" },
      { code: "11.2", description: "Lavatório completo com torneira", unit: "un", composition: "Lavatório com torneira montado" },
      { code: "11.3", description: "Chuveiro completo com misturadora", unit: "un", composition: "Chuveiro com misturadora montado" },
      { code: "11.4", description: "Lava-louça inox com torneira", unit: "un", composition: "Pia de cozinha com torneira montada" },
      { code: "11.5", description: "Tanque de lavandaria com torneira", unit: "un", composition: "Tanque de lavandaria com torneira montado" },
      { code: "11.6", description: "Rede de água fria em PPR Ø20 mm", unit: "ml", composition: "Rede de distribuição de água fria (tubo PPR Ø20mm)" },
      { code: "11.7", description: "Reservatório de água de 500 L", unit: "un", composition: "Reservatório de água instalado (500L, com suportes)" },
    ],
  },
  {
    code: "12",
    name: "SANEAMENTO AUTÓNOMO (FOSSA SÉPTICA)",
    items: [
      {
        code: "12.1",
        description: "Fossa séptica pré-fabricada",
        unit: "m3",
        composition: "Fossa séptica pré-fabricada instalada (por m³ útil)",
      },
      {
        code: "12.2",
        description: "Vala ou poço de infiltração",
        unit: "m2",
        composition: "Vala/poço de infiltração com brita e geotêxtil",
      },
    ],
  },
  {
    code: "13",
    name: "INSTALAÇÕES ELÉCTRICAS",
    items: [
      { code: "13.1", description: "Quadro eléctrico completo", unit: "un", composition: "Quadro eléctrico completo, montado e ensaiado" },
      { code: "13.2", description: "Ponto de iluminação completo", unit: "un", composition: "Ponto de iluminação completo em tubagem embutida (sem luminária)" },
      { code: "13.3", description: "Ponto de tomada 2P+T", unit: "un", composition: "Ponto de tomada 2P+T completo em tubagem embutida" },
      { code: "13.4", description: "Rede de terra e equipotencial", unit: "vg", composition: "Rede de terra e equipotencial completa, ensaiada" },
    ],
  },
  {
    code: "15",
    name: "PORTAS, JANELAS E CAIXILHARIAS",
    items: [
      { code: "15.1", description: "Portas interiores completas", unit: "un", composition: "Porta interior de madeira montada" },
      { code: "15.2", description: "Portas exteriores completas", unit: "un", composition: "Porta exterior de madeira montada" },
      { code: "15.3", description: "Janelas de alumínio com vidro", unit: "m2", composition: "Janela de alumínio com vidro montada" },
      { code: "15.4", description: "Vergas e peitoris dos vãos", unit: "ml", composition: "Peitoril/lintel em betão B25" },
    ],
  },
];

const DEFAULT_CHAPTER_METADATA: Record<string, { discipline: string; detectionTags: string[] }> = {
  "1": { discipline: "all", detectionTags: ["implantação", "estaleiro", "limpeza"] },
  "2": { discipline: "estrutura", detectionTags: ["escavação", "fundação", "aterro"] },
  "3": { discipline: "estrutura", detectionTags: ["sapata", "pilar", "viga", "laje", "armadura"] },
  "4": { discipline: "arquitectura", detectionTags: ["alvenaria", "parede", "bloco"] },
  "5": { discipline: "arquitectura", detectionTags: ["reboco", "betonilha"] },
  "6": { discipline: "arquitectura", detectionTags: ["pavimento", "mosaico", "revestimento"] },
  "7": { discipline: "arquitectura", detectionTags: ["pintura", "acabamento"] },
  "8": { discipline: "hidrossanitario", detectionTags: ["esgoto", "drenagem", "caixa de visita"] },
  "9": { discipline: "hidrossanitario", detectionTags: ["pluvial", "tubo de queda"] },
  "10": { discipline: "arquitectura", detectionTags: ["cobertura", "telhado", "impermeabilização"] },
  "11": { discipline: "hidrossanitario", detectionTags: ["água", "sanita", "lavatório", "reservatório"] },
  "12": { discipline: "hidrossanitario", detectionTags: ["fossa séptica", "infiltração", "saneamento"] },
  "13": { discipline: "electricidade", detectionTags: ["quadro eléctrico", "iluminação", "tomada", "terra"] },
  "15": { discipline: "arquitectura", detectionTags: ["porta", "janela", "caixilharia", "vão"] },
};

/** Garante uma biblioteca global versionada, sem depender de correr novamente o seed completo. */
export async function ensureDefaultWorkChapterLibrary() {
  const values: Array<typeof workItemTemplates.$inferInsert> = [];
  for (let chapterOrder = 0; chapterOrder < STANDARD_CHAPTERS.length; chapterOrder++) {
    const chapter = STANDARD_CHAPTERS[chapterOrder];
    const metadata = DEFAULT_CHAPTER_METADATA[chapter.code] ?? { discipline: "outro", detectionTags: [] };
    for (let itemOrder = 0; itemOrder < chapter.items.length; itemOrder++) {
      const item = chapter.items[itemOrder];
      values.push({
        companyId: null,
        templateKey: `global:${chapter.code}:${item.code}`,
        chapterCode: chapter.code,
        chapterName: chapter.name,
        itemCode: item.code,
        description: item.description,
        unit: item.unit,
        compositionName: item.composition ?? null,
        discipline: metadata.discipline,
        detectionTags: metadata.detectionTags,
        requiresTagMatch: false,
        chapterSortOrder: chapterOrder,
        sortOrder: itemOrder,
        version: 2,
        isActive: true,
      });
    }
  }
  for (const value of values) {
    await db
      .insert(workItemTemplates)
      .values(value)
      .onConflictDoUpdate({
        target: workItemTemplates.templateKey,
        set: {
          chapterName: value.chapterName,
          description: value.description,
          unit: value.unit,
          compositionName: value.compositionName,
          discipline: value.discipline,
          detectionTags: value.detectionTags,
          chapterSortOrder: value.chapterSortOrder,
          sortOrder: value.sortOrder,
          version: value.version,
          isActive: true,
        },
      });
  }
}

/** Biblioteca visível: um capítulo próprio da empresa substitui o global com o mesmo código. */
export async function loadWorkChapterLibrary(companyId: string): Promise<TemplateChapter[]> {
  await ensureDefaultWorkChapterLibrary();
  const rows = await db.select().from(workItemTemplates).where(and(
    eq(workItemTemplates.isActive, true),
    or(isNull(workItemTemplates.companyId), eq(workItemTemplates.companyId, companyId)),
  ));
  const usable = rows.filter((row) => row.templateKey && row.chapterCode && row.itemCode);
  const ownCodes = new Set(usable.filter((row) => row.companyId === companyId).map((row) => row.chapterCode!));
  const visible = usable.filter((row) => row.companyId === companyId || !ownCodes.has(row.chapterCode!));
  const grouped = new Map<string, TemplateChapter>();
  for (const row of visible.sort((a, b) => a.chapterSortOrder - b.chapterSortOrder || a.sortOrder - b.sortOrder)) {
    const code = row.chapterCode!;
    let chapter = grouped.get(code);
    if (!chapter) {
      chapter = {
        code,
        name: row.chapterName,
        discipline: row.discipline,
        detectionTags: row.detectionTags,
        requiresTagMatch: row.requiresTagMatch,
        version: row.version,
        companyId: row.companyId,
        items: [],
      };
      grouped.set(code, chapter);
    }
    chapter.items.push({
      code: row.itemCode!,
      description: row.description,
      unit: row.unit,
      composition: row.compositionName ?? undefined,
      compositionId: row.compositionId,
    });
  }
  return [...grouped.values()];
}

export async function getAdaptiveBoqSelection(
  companyId: string,
  context?: AdaptivePlantContext | null,
): Promise<BoqTemplateSelection> {
  const library = await loadWorkChapterLibrary(companyId);
  if (!context || (!context.disciplines.length && !context.hasRooms && !context.hasStructuralElements)) {
    return { mode: "padrao", chapters: library, detectedDisciplines: [] };
  }
  const disciplines = new Set(context.disciplines);
  if (context.hasRooms) disciplines.add("arquitectura");
  if (context.hasStructuralElements) disciplines.add("estrutura");
  const detectedTerms = new Set((context.detectedTerms ?? []).map((term) => term.toLocaleLowerCase("pt")));
  return {
    mode: "adaptativo",
    chapters: library.filter((chapter) => {
      if (chapter.discipline !== "all" && !disciplines.has(chapter.discipline ?? "outro")) return false;
      if (!chapter.requiresTagMatch) return true;
      return (chapter.detectionTags ?? []).some((tag) => detectedTerms.has(tag.toLocaleLowerCase("pt")));
    }),
    detectedDisciplines: [...disciplines].filter((discipline) => discipline !== "outro"),
  };
}

/** Selecciona apenas os capítulos sustentados pelas disciplinas efectivamente reconhecidas. */
export function selectAdaptiveBoqChapters(context?: AdaptivePlantContext | null): BoqTemplateSelection {
  if (!context || (!context.disciplines.length && !context.hasRooms && !context.hasStructuralElements)) {
    return { mode: "padrao", chapters: STANDARD_CHAPTERS, detectedDisciplines: [] };
  }

  const disciplines = new Set(context.disciplines);
  const codes = new Set<string>(["1"]);
  if (disciplines.has("arquitectura") || context.hasRooms) {
    ["4", "5", "6", "7", "10", "15"].forEach((code) => codes.add(code));
  }
  if (disciplines.has("estrutura") || context.hasStructuralElements) {
    ["2", "3"].forEach((code) => codes.add(code));
  }
  if (disciplines.has("hidrossanitario")) {
    ["8", "9", "11", "12"].forEach((code) => codes.add(code));
  }
  if (disciplines.has("electricidade")) codes.add("13");

  return {
    mode: "adaptativo",
    chapters: STANDARD_CHAPTERS.filter((chapter) => codes.has(chapter.code)),
    detectedDisciplines: [...disciplines].filter((discipline) => discipline !== "outro"),
  };
}

// Gera a estrutura padrão dentro de um documento acabado de criar. As composições são
// procuradas no catálogo visível à empresa (globais + próprias); se uma composição não
// existir, o item é criado na mesma com preço vazio (a preencher manualmente).
export async function generateStandardBoq(
  documentId: string,
  companyId: string,
  zoneId?: string | null,
  sectionName = "Edifício Principal",
  includePricing = true,
  selection?: BoqTemplateSelection,
) {
  const effectiveSelection = selection ?? { mode: "padrao" as const, chapters: await loadWorkChapterLibrary(companyId), detectedDisciplines: [] };
  const visibleCompositions = await db
    .select()
    .from(costCompositions)
    .where(or(isNull(costCompositions.companyId), eq(costCompositions.companyId, companyId)));
  // Globais primeiro, depois as da empresa — para que uma composição clonada/ajustada
  // pela empresa tenha sempre prioridade sobre a versão partilhada com o mesmo nome.
  const byName = new Map<string, string>();
  for (const c of visibleCompositions.filter((c) => c.companyId === null)) byName.set(c.name, c.id);
  for (const c of visibleCompositions.filter((c) => c.companyId !== null)) byName.set(c.name, c.id);

  const unitCostCache = new Map<string, number>();
  async function unitCostOf(compositionId: string): Promise<number> {
    if (!unitCostCache.has(compositionId)) {
      const breakdown = await computeCompositionUnitCostV2(compositionId, companyId, zoneId);
      unitCostCache.set(compositionId, breakdown.unitCost);
    }
    return unitCostCache.get(compositionId)!;
  }

  const [section] = await db.insert(budgetSections).values({
    documentId,
    name: sectionName,
    sortOrder: 0,
    templateKey: effectiveSelection.mode === "adaptativo" ? "sigo_adaptativo_v2" : "sigo_padrao_v2",
  }).returning();

  let chapterOrder = 0;
  for (const chapter of effectiveSelection.chapters) {
    const [chapterRow] = await db
      .insert(lineItems)
      .values({
        sectionId: section.id,
        parentId: null,
        kind: "capitulo",
        code: chapter.code,
        description: chapter.name,
        origin: "manual",
        sortOrder: chapterOrder++,
      })
      .returning();

    let itemOrder = 0;
    for (const item of chapter.items) {
      const compositionId = item.composition ? byName.get(item.composition) ?? item.compositionId ?? null : item.compositionId ?? null;
      const unitPrice = compositionId && includePricing ? await unitCostOf(compositionId) : null;
      await db.insert(lineItems).values({
        sectionId: section.id,
        parentId: chapterRow.id,
        kind: "item",
        code: item.code,
        description: item.description,
        unit: item.unit,
        quantity: "0",
        unitPrice: unitPrice !== null ? fixedSigo(unitPrice) : null,
        compositionId,
        origin: compositionId ? "composicao" : "manual",
        sortOrder: itemOrder++,
      });
    }
  }

  return section;
}
