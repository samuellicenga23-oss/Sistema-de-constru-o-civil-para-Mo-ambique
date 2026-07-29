import { eq } from "drizzle-orm";
import { db, sql } from "./index.js";
import { companies, projects, budgetDocuments, budgetSections, lineItems } from "./schema.js";
import type { LineItemKind, Unit } from "@sigo/shared";

// Replica fielmente a estrutura real de "MAPA DE QUANTIDADES - EDIFICIO DR CASTRO.xlsx"
// (capítulos/itens/quantidades tal como no ficheiro original). Os preços unitários são
// ESTIMATIVAS ILUSTRATIVAS (o ficheiro original vem com preço em branco, a preencher pelo
// empreiteiro em concurso) — servem para o sistema mostrar valores realistas, não são
// uma referência de mercado.
type ItemSpec = {
  kind: LineItemKind;
  code?: string | null;
  description: string;
  unit?: Unit | null;
  quantity?: number | null;
  unitPrice?: number | null;
  children?: ItemSpec[];
};

const TREE: ItemSpec[] = [
  {
    kind: "capitulo",
    code: "1",
    description: "TRABALHOS PRELIMINARES",
    children: [
      { kind: "item", code: "1.1", description: "Limpeza do terreno, regularização do terreno, remoção e/ou do lixo ao vazadouro e trabalhos complementares", unit: "m2", quantity: 961.39, unitPrice: 0.5 },
      { kind: "item", code: "1.2", description: "Implantação da obra, incluindo remoção da camada vegetal em 150mm, nivelamento do terreno e trabalhos complementares", unit: "m2", quantity: 2137, unitPrice: 0.35 },
      { kind: "item", code: "1.3", description: "Tratamento do solo contra muchém, xilófagos e outras pragas de insectos, em toda a área de ampliação incluindo o espaço envolvente do edifício num raio de 1,5 m", unit: "m2", quantity: 227.86, unitPrice: 0.9 },
    ],
  },
  {
    kind: "capitulo",
    code: "2",
    description: "MOVIMENTOS DE TERRA",
    children: [
      { kind: "item", code: "2.1", description: "Escavação e elevação de terras na abertura de caboucos para fundações isoladas, corridas e caixas de pavimento", unit: "m3", quantity: 69.79, unitPrice: 8 },
      { kind: "item", code: "2.2", description: "Rega e compactação em base de fundações e caixas de pavimento a 95% AASHTO", unit: "m2", quantity: 66.42, unitPrice: 1.2 },
      { kind: "item", code: "2.3", description: "Reaterro com solos provenientes da escavação e de empréstimo, regados e compactados em fundações", unit: "m3", quantity: 66.48, unitPrice: 5 },
      { kind: "item", code: "2.4", description: "Aterro com solos provenientes da escavação e de empréstimo, regados e compactados em caixas de pavimento", unit: "m3", quantity: 167.29, unitPrice: 6 },
      { kind: "item", code: "2.5", description: "F/A e compactação de enrocamento com pedra mediana em leito de fundações com 100 mm de espessura", unit: "m3", quantity: 6.64, unitPrice: 15 },
      { kind: "item", code: "2.6", description: "F/A e compactação de enrocamento com pedra mediana em caixas de pavimento térreo com 150 mm de espessura", unit: "m3", quantity: 20.91, unitPrice: 18 },
      { kind: "item", code: "2.8", description: "F/A de membrana polietileno, 275 micron, SABS 952-1985 tipo C, com sobreposição de 200mm, em caixas de pavimento", unit: "m2", quantity: 139.41, unitPrice: 2.5 },
    ],
  },
  {
    kind: "capitulo",
    code: "3",
    description: "BETÕES, AÇOS E COFRAGENS",
    children: [
      { kind: "item", code: "3.1", description: "Fabrico e aplicação do betão de classe B25, em sapatas isoladas", unit: "m3", quantity: 3.31, unitPrice: 150 },
      { kind: "item", code: "3.3", description: "Fabrico e aplicação do betão de classe B15, Betão de Limpeza em fundações e sapatas", unit: "m3", quantity: 3.3, unitPrice: 110 },
      { kind: "item", code: "3.4", description: "Fabrico e aplicação do betão de classe B25, em pilares", unit: "m3", quantity: 4.38, unitPrice: 155 },
      { kind: "item", code: "3.5", description: "Fabrico e aplicação do betão de classe B25, em vigas de pavimento, ao longo do perímetro do edifício", unit: "m3", quantity: 6.33, unitPrice: 150 },
      { kind: "item", code: "3.6", description: "Fabrico e aplicação do betão de classe B25, em laje do pavimento térreo", unit: "m3", quantity: 13.04, unitPrice: 145 },
      { kind: "item", code: "3.7", description: "Fabrico e aplicação do betão de classe B25, em lajes do edifício", unit: "m3", quantity: 13.05, unitPrice: 150 },
      { kind: "item", code: "3.8", description: "Fabrico e aplicação do betão de classe B25, em Vigas estruturais, lintéis e peitoris", unit: "m3", quantity: 39.45, unitPrice: 160 },
      {
        kind: "grupo",
        code: "3.9",
        description: "Fornecimento e assentamento de aço A400 incluindo corte, dobragem e amarração, de acordo com o plano de armaduras",
        children: [
          {
            kind: "grupo",
            description: "Em Sapatas e Arranque de pilar",
            children: [
              { kind: "item", description: "Ø6mm", unit: "kg", quantity: 14.72, unitPrice: 1.3 },
              { kind: "item", description: "Ø10mm", unit: "kg", quantity: 20.82, unitPrice: 1.3 },
              { kind: "item", description: "Ø12mm", unit: "kg", quantity: 216.71, unitPrice: 1.3 },
            ],
          },
          {
            kind: "grupo",
            description: "Em pilares",
            children: [
              { kind: "item", description: "Ø6mm", unit: "kg", quantity: 101.54, unitPrice: 1.3 },
              { kind: "item", description: "Ø12mm", unit: "kg", quantity: 460.26, unitPrice: 1.3 },
            ],
          },
          {
            kind: "grupo",
            description: "Em Viga de Fundação",
            children: [
              { kind: "item", description: "Ø6mm", unit: "kg", quantity: 206.09, unitPrice: 1.3 },
              { kind: "item", description: "Ø10mm", unit: "kg", quantity: 246.07, unitPrice: 1.3 },
            ],
          },
          {
            kind: "grupo",
            description: "Em Viga da caixa de Fundação",
            children: [
              { kind: "item", description: "Ø6mm", unit: "kg", quantity: 206.09, unitPrice: 1.3 },
              { kind: "item", description: "Ø8mm", unit: "kg", quantity: 157.53, unitPrice: 1.3 },
            ],
          },
          {
            kind: "grupo",
            description: "Em Vigas",
            children: [
              { kind: "item", description: "Ø6mm", unit: "kg", quantity: 210.98, unitPrice: 1.3 },
              { kind: "item", description: "Ø10mm", unit: "kg", quantity: 340.6, unitPrice: 1.3 },
              { kind: "item", description: "Ø12mm", unit: "kg", quantity: 139.26, unitPrice: 1.3 },
              { kind: "item", description: "Ø16mm", unit: "kg", quantity: 120.16, unitPrice: 1.3 },
            ],
          },
          {
            kind: "grupo",
            description: "Em Escadas",
            children: [
              { kind: "item", description: "Ø8mm", unit: "kg", quantity: 7.17, unitPrice: 1.3 },
              { kind: "item", description: "Ø10mm", unit: "kg", quantity: 21.43, unitPrice: 1.3 },
              { kind: "item", description: "Ø12mm", unit: "kg", quantity: 121.92, unitPrice: 1.3 },
            ],
          },
        ],
      },
      { kind: "item", code: "3.9.5", description: "Fornecimento e assentamento de malhasol AQ38 em lajes de cobertura", unit: "m2", quantity: 269.41, unitPrice: 3.5 },
      {
        kind: "grupo",
        code: "3.11",
        description: "Fornecimento e assentamento de cofragem e descofragem de madeira ou metálica em:",
        children: [
          { kind: "item", code: "3.11.1", description: "Vigas de Pavimento", unit: "m2", quantity: 94.97, unitPrice: 12 },
          { kind: "item", code: "3.11.2", description: "Laje de Pavimento", unit: "m2", quantity: 11.6, unitPrice: 12 },
          { kind: "item", code: "3.11.3", description: "Pilares", unit: "m2", quantity: 79.52, unitPrice: 13 },
          { kind: "item", code: "3.11.4", description: "Vigas estruturais, Lintéis, Vergas e Peitoris e lajes", unit: "m2", quantity: 315.5, unitPrice: 12 },
          { kind: "item", code: "3.11.5", description: "Sapatas Isoladas", unit: "m2", quantity: 15.6, unitPrice: 14 },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "4",
    description: "ALVENARIAS",
    children: [
      { kind: "nota", code: "Nota:", description: "Inclui o fornecimento de todos os materiais, isolamentos, execução de meia cana em paredes duplas exteriores, gateamentos, vergas onde existam vãos, travamentos em betão armado sempre que necessário." },
      { kind: "item", code: "4.1", description: "Fornecimento e assentamento de alvenaria de blocos maciçados de fundação vibrados de cimento, areia e pó de pedra com 400x200x200mm, ao traço 1:4", unit: "m2", quantity: 81.79, unitPrice: 45 },
      { kind: "item", code: "4.2", description: "Fornecimento e assentamento de alvenaria de blocos vazados vibrados de cimento, areia e pó de pedra com 400x200x150mm, ao traço 1:4", unit: "m2", quantity: 437.96, unitPrice: 40 },
      { kind: "item", code: "4.3", description: "Fornecimento e assentamento de abobadilhas de blocos vibrados de cimento, areia e pó de pedra conforme o especificado no projecto", unit: "m2", quantity: 269.41, unitPrice: 35 },
      {
        kind: "grupo",
        code: "4.4",
        description: "Fornecimento e assentamento de Vigotas pré-esforçadas conforme o especificado no projecto",
        children: [
          {
            kind: "grupo",
            description: "dimensões",
            children: [
              { kind: "item", description: "110x100x40x4m", unit: "un", quantity: 30, unitPrice: 25 },
              { kind: "item", description: "110x100x40x5.20m", unit: "un", quantity: 38, unitPrice: 30 },
              { kind: "item", description: "110x100x40x5.78m", unit: "un", quantity: 42, unitPrice: 33 },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "7",
    description: "BETONILHAS E REBOCOS",
    children: [
      { kind: "nota", code: "Nota:", description: "Inclui o fornecimento de todos os materiais, todos os trabalhos preparatórios e complementares, em conformidade com as regras de boa execução." },
      {
        kind: "grupo",
        code: "7.1",
        description: "BETONILHAS",
        children: [{ kind: "item", code: "7.1.1", description: "Betonilha pré-misturada, de regularização e enchimento, para receber revestimento final (pavimentos)", unit: "m2", quantity: 158.48, unitPrice: 6 }],
      },
      {
        kind: "grupo",
        code: "7.2",
        description: "REBOCOS",
        children: [
          { kind: "item", code: "7.2.1", description: "Argamassa de reboco hidráulico para exteriores, com acabamento estanhado, pronto a receber pintura", unit: "m2", quantity: 308.49, unitPrice: 5.5 },
          { kind: "item", code: "7.2.2", description: "Reboco para interiores, com acabamento estanhado, pronto a receber pinturas", unit: "m2", quantity: 670.55, unitPrice: 4.5 },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "8",
    description: "REVESTIMENTO DE PAVIMENTOS E RODAPÉS",
    children: [
      { kind: "nota", code: "Nota:", description: "Inclui o fornecimento de todos os materiais, argamassas de colagem de cerâmica, argamassas coloridas para betumação de juntas e perfis de transição." },
      {
        kind: "grupo",
        code: "8.1",
        description: "PAVIMENTOS",
        children: [
          { kind: "item", code: "8.1.1", description: "Fornecimento e assentamento de mosaico cerâmico a escolha do dono da obra em wcs pavimentos", unit: "m2", quantity: 16.37, unitPrice: 20 },
          { kind: "item", code: "8.1.2", description: "Fornecimento e assentamento de mosaico cerâmico a escolha do dono da obra em wcs paredes", unit: "m2", quantity: 54.11, unitPrice: 22 },
          { kind: "item", code: "8.1.3", description: "Fornecimento e assentamento de mosaico cerâmico a escolha do dono da obra em cozinha pavimento", unit: "m2", quantity: 15.64, unitPrice: 20 },
          { kind: "item", code: "8.1.4", description: "Fornecimento e assentamento de mosaico cerâmico a escolha do dono da obra em cozinha parede", unit: "m2", quantity: 42.62, unitPrice: 22 },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "9",
    description: "PINTURAS",
    children: [
      { kind: "nota", code: "Nota:", description: "Inclui o fornecimento de todos os materiais, em conformidade com as regras de boa execução e instruções dos fabricantes." },
      {
        kind: "grupo",
        code: "10.1",
        description: "PINTURAS EM PAREDES E TECTOS EXTERIORES",
        children: [
          { kind: "item", code: "10.1.1", description: 'Pintura a tinta 100% acrílica para exteriores reforçada com quartzo tipo "CIN NOVATEX HD", incluindo primário', unit: "m2", quantity: 308.49, unitPrice: 4 },
        ],
      },
      {
        kind: "grupo",
        code: "10.2",
        description: "PINTURAS EM PAREDES INTERIORES",
        children: [
          { kind: "item", code: "10.2.1", description: "Pintura a tinta de esmalte aquoso para interiores, acabamento liso mate, incluindo primário", unit: "m2", quantity: 437.96, unitPrice: 3 },
        ],
      },
      {
        kind: "grupo",
        code: "10.2",
        description: "PINTURAS EM TECTOS INTERIORES",
        children: [
          { kind: "item", code: "10.2.1", description: "Pintura a tinta de esmalte aquoso para interiores, acabamento liso mate, incluindo primário", unit: "m2", quantity: 232.59, unitPrice: 3.2 },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "16",
    description: "DRENAGEM DE ESGOTOS",
    children: [
      { kind: "nota", description: "NOTAS: As ligações em uPVC serão sempre efectuadas com os acessórios adequados. A tubagem uPVC deverá ter certificações SABS 791 ou SABS 1601." },
      {
        kind: "grupo",
        code: "16.1",
        description: "Tubagem e Acessórios",
        children: [
          {
            kind: "grupo",
            code: "16.1.1",
            description: "F/M de tubos plásticos uPVC, série B, de ligação entre os dispositivos de esgoto e as caixas de visita",
            children: [
              { kind: "item", code: "16.1.1.4", description: "Ø110 mm", unit: "ml", quantity: 68, unitPrice: 8 },
              { kind: "item", code: "16.1.1.5", description: "Ø40 mm", unit: "ml", quantity: 74, unitPrice: 6 },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "capitulo",
    code: "17",
    description: "DRENAGEM DE ÁGUAS PLUVIAIS",
    children: [
      { kind: "nota", description: "NOTAS: As ligações em uPVC serão sempre efectuadas com os acessórios adequados. A tubagem uPVC deverá ter certificações SABS 791 ou SABS 1601." },
      {
        kind: "grupo",
        code: "17.1",
        description: "Tubagem e Acessórios",
        children: [
          {
            kind: "grupo",
            code: "17.1.2",
            description: "Fornecimento e montagem de tubo de queda em PVC, incluindo material auxiliar e acessórios",
            children: [{ kind: "item", code: "17.1.2.2", description: "Ø80 mm", unit: "m", quantity: 32, unitPrice: 7 }],
          },
        ],
      },
    ],
  },
];

async function insertTree(sectionId: string, parentId: string | null, specs: ItemSpec[]) {
  let sortOrder = 0;
  for (const spec of specs) {
    const [row] = await db
      .insert(lineItems)
      .values({
        sectionId,
        parentId,
        kind: spec.kind,
        code: spec.code ?? null,
        description: spec.description,
        unit: spec.unit ?? null,
        quantity: spec.quantity !== undefined && spec.quantity !== null ? spec.quantity.toString() : null,
        unitPrice: spec.unitPrice !== undefined && spec.unitPrice !== null ? spec.unitPrice.toString() : null,
        origin: "manual",
        sortOrder: sortOrder++,
      })
      .returning();
    if (spec.children?.length) {
      await insertTree(sectionId, row.id, spec.children);
    }
  }
}

export async function seedDrCastro() {
  const [demoCompany] = await db.select().from(companies).where(eq(companies.name, "Empresa Demo Lda")).limit(1);
  if (!demoCompany) {
    console.log("Empresa Demo Lda não encontrada — corre o seed principal primeiro.");
    return;
  }

  const [existing] = await db.select().from(projects).where(eq(projects.name, "Edifício Dona Mayza Chantele Cabral")).limit(1);
  if (existing) {
    console.log("projecto Dr Castro já existe, a saltar");
    return;
  }

  const [project] = await db
    .insert(projects)
    .values({
      companyId: demoCompany.id,
      name: "Edifício Dona Mayza Chantele Cabral",
      client: "Gilberto Manuel Manhiça",
      phase: "Projecto Executivo",
      currency: "USD",
      ivaRate: "0.16",
      contingenciasRate: "0.10",
    })
    .returning();

  const [document] = await db
    .insert(budgetDocuments)
    .values({
      projectId: project.id,
      title: "Mapa de Quantidades",
      revision: "0",
      currency: "USD",
      ivaRate: "0.16",
      contingenciasRate: "0.10",
    })
    .returning();

  const [section] = await db.insert(budgetSections).values({ documentId: document.id, name: "Edifício Principal", sortOrder: 0 }).returning();

  await insertTree(section.id, null, TREE);

  console.log(`projecto Dr Castro semeado: ${project.name} (documento ${document.title})`);
}

async function main() {
  await seedDrCastro();
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
