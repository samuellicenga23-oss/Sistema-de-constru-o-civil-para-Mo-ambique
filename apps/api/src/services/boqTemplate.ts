import { eq, isNull, or, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems, costCompositions } from "../db/schema.js";
import { computeCompositionUnitCost } from "./costEngine.js";

// Estrutura padrão de um Mapa de Quantidades moçambicano (capítulos e trabalhos correntes,
// derivada dos ficheiros reais analisados: Dr Castro, Centro de Excelência TB, UEM).
// Cada item pode referenciar uma composição do catálogo pelo nome — o preço unitário é
// calculado no momento da geração; quantidades começam a 0 para serem preenchidas por
// medições dimensionais (Nº × Comp. × Larg. × Alt.) ou manualmente.
type TemplateItem = { code: string; description: string; unit: string; composition?: string };
type TemplateChapter = { code: string; name: string; items: TemplateItem[] };

export const STANDARD_CHAPTERS: TemplateChapter[] = [
  {
    code: "1",
    name: "TRABALHOS PRELIMINARES",
    items: [
      { code: "1.1", description: "Limpeza e regularização do terreno, remoção do lixo ao vazadouro e trabalhos complementares", unit: "m2", composition: "Remoção e limpeza do terreno até 20cm de profundidade" },
      { code: "1.2", description: "Implantação da obra, marcação e colocação de cangalho", unit: "ml", composition: "Implantação da obra / montagem de cangalho" },
      { code: "1.3", description: "Tratamento do solo contra térmitas e xilófagos em toda a área de construção", unit: "m2", composition: "Tratamento anti-térmitas do solo" },
    ],
  },
  {
    code: "2",
    name: "MOVIMENTOS DE TERRA",
    items: [
      { code: "2.1", description: "Escavação em fundações (isoladas, corridas e caixas de pavimento), incluindo baldeação", unit: "m3", composition: "Escavação manual em fundações (incl. baldeação)" },
      { code: "2.2", description: "Reaterro com solos provenientes da escavação, regados e compactados", unit: "m3", composition: "Reaterro compactado com solos da escavação" },
      { code: "2.3", description: "Aterro com terras de empréstimo, regadas e compactadas", unit: "m3", composition: "Aterro com terras de empréstimo compactado" },
      { code: "2.4", description: "Enrocamento com pedra em leito de fundações e caixas de pavimento", unit: "m3", composition: "Enrocamento com pedra em fundações/pavimentos" },
      { code: "2.5", description: "F/A de membrana de polietileno 275 micron em caixas de pavimento", unit: "m2", composition: "Membrana de polietileno em caixas de pavimento" },
    ],
  },
  {
    code: "3",
    name: "BETÕES, AÇOS E COFRAGENS",
    items: [
      { code: "3.1", description: "Betão de limpeza B15 em fundações e sapatas", unit: "m3", composition: "Betão B15 (betão de limpeza)" },
      { code: "3.2", description: "Betão estrutural B25 em sapatas isoladas e corridas", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.3", description: "Betão estrutural B25 em pilares", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.4", description: "Betão estrutural B25 em vigas de fundação, lintéis e peitoris", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.5", description: "Betão estrutural B25 em lajes", unit: "m3", composition: "Betão B25 (estrutural)" },
      { code: "3.6", description: "Fornecimento e assentamento de aço A400, incluindo corte, dobragem e amarração", unit: "kg", composition: "Aço A400 aplicado (corte, dobragem e amarração)" },
      { code: "3.7", description: "Fornecimento e assentamento de malhasol AQ38", unit: "m2", composition: "Malhasol AQ38 aplicado" },
      { code: "3.8", description: "Cofragem e descofragem de madeira em elementos estruturais", unit: "m2", composition: "Cofragem e descofragem de madeira" },
    ],
  },
  {
    code: "4",
    name: "ALVENARIAS",
    items: [
      { code: "4.1", description: "Alvenaria de blocos de cimento 400x200x200mm ao traço 1:4", unit: "m2", composition: "Alvenaria de bloco 20 (400x200x200mm)" },
      { code: "4.2", description: "Alvenaria de blocos de cimento 400x200x150mm ao traço 1:4", unit: "m2", composition: "Alvenaria de bloco 15 (400x200x150mm)" },
    ],
  },
  {
    code: "5",
    name: "BETONILHAS E REBOCOS",
    items: [
      { code: "5.1", description: "Betonilha de regularização para receber revestimento final", unit: "m2", composition: "Betonilha de regularização" },
      { code: "5.2", description: "Reboco interior com acabamento estanhado, pronto a receber pintura", unit: "m2", composition: "Reboco interior estanhado" },
      { code: "5.3", description: "Reboco exterior hidrófugo com acabamento estanhado", unit: "m2", composition: "Reboco exterior hidrófugo" },
    ],
  },
  {
    code: "6",
    name: "REVESTIMENTO DE PAVIMENTOS E PAREDES",
    items: [
      { code: "6.1", description: "Fornecimento e assentamento de mosaico cerâmico em pavimentos", unit: "m2", composition: "Assentamento de mosaico cerâmico" },
      { code: "6.2", description: "Fornecimento e assentamento de mosaico cerâmico em paredes (wc/cozinha)", unit: "m2", composition: "Assentamento de mosaico cerâmico" },
    ],
  },
  {
    code: "7",
    name: "PINTURAS",
    items: [
      { code: "7.1", description: "Pintura acrílica em paredes exteriores (2 demãos, incl. primário)", unit: "m2", composition: "Pintura acrílica exterior (2 demãos + primário)" },
      { code: "7.2", description: "Pintura de esmalte aquoso em paredes interiores (2 demãos, incl. primário)", unit: "m2", composition: "Pintura esmalte aquoso interior (2 demãos + primário)" },
      { code: "7.3", description: "Pintura de esmalte aquoso em tectos interiores (2 demãos, incl. primário)", unit: "m2", composition: "Pintura esmalte aquoso interior (2 demãos + primário)" },
    ],
  },
  {
    code: "8",
    name: "DRENAGEM DE ESGOTOS",
    items: [
      { code: "8.1", description: "F/M de tubagem uPVC Ø110mm, série B, incluindo acessórios e abertura/fecho de valas", unit: "ml", composition: "Tubagem uPVC Ø110mm assente (esgotos)" },
      { code: "8.2", description: "F/M de tubagem uPVC Ø40mm, série B, incluindo acessórios", unit: "ml", composition: "Tubagem uPVC Ø40mm assente (esgotos)" },
      { code: "8.3", description: "Fornecimento e assentamento de caixa de visita de esgotos", unit: "un", composition: "Caixa de visita de esgotos montada" },
    ],
  },
  {
    code: "9",
    name: "DRENAGEM DE ÁGUAS PLUVIAIS",
    items: [
      { code: "9.1", description: "F/M de tubo de queda PVC Ø80mm, incluindo fixações e acessórios", unit: "m", composition: "Tubo de queda PVC Ø80mm montado (pluviais)" },
    ],
  },
  {
    code: "10",
    name: "COBERTURA",
    items: [
      { code: "10.1", description: "Impermeabilização da laje de cobertura com tela asfáltica", unit: "m2", composition: "Impermeabilização de laje de cobertura (tela asfáltica)" },
      { code: "10.2", description: "Cobertura em chapa metálica ondulada, incluindo vigamento de madeira", unit: "m2", composition: "Cobertura em chapa metálica ondulada" },
      { code: "10.3", description: "Cumeeira e remates de cobertura", unit: "ml", composition: "Cumeeira / remate de cobertura" },
    ],
  },
  {
    code: "11",
    name: "INSTALAÇÃO HIDRÁULICA",
    items: [
      { code: "11.1", description: "Fornecimento e montagem de sanita completa com autoclismo", unit: "un", composition: "Sanita completa montada (com autoclismo)" },
      { code: "11.2", description: "Fornecimento e montagem de lavatório com torneira", unit: "un", composition: "Lavatório com torneira montado" },
      { code: "11.3", description: "Fornecimento e montagem de base de duche/chuveiro com misturadora", unit: "un", composition: "Chuveiro com misturadora montado" },
      { code: "11.4", description: "Fornecimento e montagem de pia de cozinha com torneira", unit: "un", composition: "Pia de cozinha com torneira montada" },
      { code: "11.5", description: "Fornecimento e montagem de tanque de lavandaria com torneira", unit: "un", composition: "Tanque de lavandaria com torneira montado" },
      { code: "11.6", description: "Rede de distribuição interna de água fria em tubo PPR Ø20mm, incluindo acessórios", unit: "ml", composition: "Rede de distribuição de água fria (tubo PPR Ø20mm)" },
      { code: "11.7", description: "Fornecimento e instalação de reservatório de água (500L), incluindo suportes", unit: "un", composition: "Reservatório de água instalado (500L, com suportes)" },
    ],
  },
  {
    code: "12",
    name: "SANEAMENTO AUTÓNOMO (FOSSA SÉPTICA)",
    items: [
      // Sem composição de custo associada de propósito: o volume/área vêm de tabelas de
      // dimensionamento reais (nº de pessoas × capitação, tipo de solo — ver quickEstimate.ts),
      // mas o custo de construção (pré-fabricada comprada vs betão armado no local) varia demais
      // consoante o método, por isso o preço unitário fica sempre para o utilizador preencher.
      { code: "12.1", description: "Fossa séptica (volume dimensionado para o nº de pessoas e capitação indicados)", unit: "m3" },
      { code: "12.2", description: "Vala/poço de infiltração (área dimensionada para o tipo de solo indicado)", unit: "m2" },
    ],
  },
];

// Gera a estrutura padrão dentro de um documento acabado de criar. As composições são
// procuradas no catálogo visível à empresa (globais + próprias); se uma composição não
// existir, o item é criado na mesma com preço vazio (a preencher manualmente).
export async function generateStandardBoq(documentId: string, companyId: string, zoneId?: string | null, sectionName = "Edifício Principal") {
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
      const breakdown = await computeCompositionUnitCost(compositionId, zoneId);
      unitCostCache.set(compositionId, breakdown.unitCost);
    }
    return unitCostCache.get(compositionId)!;
  }

  const [section] = await db.insert(budgetSections).values({ documentId, name: sectionName, sortOrder: 0 }).returning();

  let chapterOrder = 0;
  for (const chapter of STANDARD_CHAPTERS) {
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
      const compositionId = item.composition ? byName.get(item.composition) ?? null : null;
      const unitPrice = compositionId ? await unitCostOf(compositionId) : null;
      await db.insert(lineItems).values({
        sectionId: section.id,
        parentId: chapterRow.id,
        kind: "item",
        code: item.code,
        description: item.description,
        unit: item.unit as any,
        quantity: "0",
        unitPrice: unitPrice !== null ? unitPrice.toString() : null,
        compositionId,
        origin: compositionId ? "composicao" : "manual",
        sortOrder: itemOrder++,
      });
    }
  }

  return section;
}
