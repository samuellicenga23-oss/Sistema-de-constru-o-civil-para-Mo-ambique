import { and, eq, isNull } from "drizzle-orm";
import { db } from "./index.js";
import {
  labourCategories,
  materials,
  equipment,
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  workItemTemplates,
  priceZones,
} from "./schema.js";
import { computeHourlyRate } from "../services/costEngine.js";

// Dados-base extraídos de "ESTUDO DE PRECOS MASTER" e "Lista de quantidades" (UEM) —
// catálogo global partilhado (companyId nulo), editável por cada empresa depois.
const WORKING_DAYS_PER_MONTH = 22;
const WORKING_HOURS_PER_DAY = 9;
const PRICE_DATE = "2026-08-03";
const INE_CONSTRUCTION_SOURCE = "INE Moçambique — preços de insumos + revisão SIGO 2026";
const INE_CONSTRUCTION_REFERENCE = "https://ine.gov.mz/documents/20119/235090/05.Pre%C3%A7os%20M%C3%A9dios%20de%20Insumos%20de%20Constru%C3%A7%C3%A3o%20Civil-MAIO%202023.pdf/4c0f6e7e-0c31-c448-5a49-757bc1da9a91?download=true";
const LABOUR_SOURCE = "Diploma Ministerial n.º 39/2026 — Construção";
const LABOUR_REFERENCE = "https://inm.gov.mz/pt-br/content/sum%C3%A1rio-br-n%C2%BA-94-de-200526-boletim-da-rep%C3%BAblica-i-serie-p%C3%A1g-489";

// Salários revistos com base no Diploma Ministerial n.º 39/2026: mínimo do sector da
// construção de 8.652 MT/mês. Nenhuma categoria fica abaixo do mínimo; funções qualificadas
// usam bandas superiores coerentes com os preços de insumos publicados pelo INE.
const LABOUR_CATEGORIES = [
  { name: "Servente", monthlySalary: 9000 },
  { name: "Carpinteiro B", monthlySalary: 10500 },
  { name: "Pedreiro A", monthlySalary: 17000 },
  { name: "Ferreiro", monthlySalary: 10500 },
  { name: "Armador de Ferro", monthlySalary: 11000 },
  { name: "Topógrafo", monthlySalary: 14000 },
];

// Valores-base sem IVA. A referência nacional parte da tabela de insumos do INE e foi
// confrontada com preços públicos de fornecedores de Maputo em Agosto de 2026. Cotações da
// empresa e preços por zona continuam a substituir estes valores sempre que existirem.
// `purchasePackage` (opcional): unidade de compra de mercado, quando difere da unidade de
// medida usada nas composições (ex: areia medida em m3, vendida por camião) — editável depois
// no Catálogo, por material; a dimensão real do camião/saco varia por fornecedor.
const MATERIALS = [
  { name: "Cimento (saco 50kg)", unit: "un" as const, baseUnitCost: 430, importFactor: 1, purchasePackage: { label: "Saco 50kg", qty: 1 } },
  { name: "Areia grossa", unit: "m3" as const, baseUnitCost: 1055, importFactor: 1, purchasePackage: { label: "Camião 22m³", qty: 22 } },
  { name: "Areia fina", unit: "m3" as const, baseUnitCost: 625, importFactor: 1, purchasePackage: { label: "Camião 22m³", qty: 22 } },
  { name: "Brita 3/4", unit: "m3" as const, baseUnitCost: 920, importFactor: 1, purchasePackage: { label: "Camião 22m³", qty: 22 } },
  { name: "Saibro", unit: "m3" as const, baseUnitCost: 500, importFactor: 1, purchasePackage: { label: "Camião 22m³", qty: 22 } },
  { name: "Aço A400", unit: "kg" as const, baseUnitCost: 87, importFactor: 1.05 },
  // Retalho Maputo/Matola 2026 (~31–32 / ~25); preço posto obra ligeiramente acima.
  { name: "Bloco de cimento 20x20x40", unit: "un" as const, baseUnitCost: 33, importFactor: 1, purchasePackage: { label: "Palete (100 un)", qty: 100 } },
  { name: "Bloco de cimento 15x20x40", unit: "un" as const, baseUnitCost: 26, importFactor: 1, purchasePackage: { label: "Palete (100 un)", qty: 100 } },
];

// Zonas de preço comuns na área da Grande Maputo — o custo de materiais varia sobretudo pelo
// transporte a partir dos fornecedores/pedreiras da cidade; lista de partida, geríveis depois
// (renomear/adicionar) tal como as restantes categorias do catálogo.
const PRICE_ZONES = [
  "Baixa / Polana / Sommerschield",
  "Malhangalene / Alto Maé",
  "Zonas Suburbanas (Magoanine, Zimpeto, Costa do Sol...)",
  "Matola",
  "Marracuene / Zona Verde",
  "Boane",
];

const EQUIPMENT = [
  { name: "Placa compactadora", unit: "h" as const, hourlyCost: 152 },
  { name: "Betoneira", unit: "h" as const, hourlyCost: 100 },
  { name: "Dumper", unit: "h" as const, hourlyCost: 600 },
];

// Catálogo de tipos de trabalho reutilizável — capítulos/itens reais vistos nos mapas de
// quantidades analisados (Dr Castro, Centro de Excelência TB, UEM).
const WORK_ITEM_TEMPLATES: Array<{ chapterCode: string; chapterName: string; description: string; unit: string }> = [
  { chapterCode: "1", chapterName: "Trabalhos Preliminares", description: "Limpeza do terreno, remoção do lixo ao vazadouro", unit: "m2" },
  { chapterCode: "1", chapterName: "Trabalhos Preliminares", description: "Implantação da obra e marcação do cangalho", unit: "ml" },
  { chapterCode: "2", chapterName: "Movimentos de Terra", description: "Escavação e elevação de terras para fundações", unit: "m3" },
  { chapterCode: "2", chapterName: "Movimentos de Terra", description: "Aterro com solos de empréstimo, regado e compactado", unit: "m3" },
  { chapterCode: "3", chapterName: "Betões, Aços e Cofragens", description: "Fabrico e aplicação de betão classe B25 em sapatas", unit: "m3" },
  { chapterCode: "3", chapterName: "Betões, Aços e Cofragens", description: "Fornecimento e assentamento de aço A400", unit: "kg" },
  { chapterCode: "3", chapterName: "Betões, Aços e Cofragens", description: "Cofragem e descofragem em vigas/pilares/lajes", unit: "m2" },
  { chapterCode: "4", chapterName: "Alvenarias", description: "Alvenaria de blocos vazados de cimento e areia", unit: "m2" },
  { chapterCode: "7", chapterName: "Betonilhas e Rebocos", description: "Betonilha pré-misturada de regularização", unit: "m2" },
  { chapterCode: "7", chapterName: "Betonilhas e Rebocos", description: "Reboco para interiores/exteriores", unit: "m2" },
  { chapterCode: "8", chapterName: "Revestimento de Pavimentos e Rodapés", description: "Mosaico cerâmico em pavimentos e paredes", unit: "m2" },
  { chapterCode: "9", chapterName: "Pinturas", description: "Pintura acrílica em paredes exteriores", unit: "m2" },
  { chapterCode: "9", chapterName: "Pinturas", description: "Pintura de esmalte aquoso em paredes/tectos interiores", unit: "m2" },
  { chapterCode: "16", chapterName: "Drenagem de Esgotos", description: "Tubagem uPVC série B e acessórios", unit: "ml" },
  { chapterCode: "17", chapterName: "Drenagem de Águas Pluviais", description: "Tubo de queda em PVC e acessórios", unit: "m" },
];

async function seedLabourCategories() {
  for (const cat of LABOUR_CATEGORIES) {
    const hourlyRate = computeHourlyRate(cat.monthlySalary, WORKING_DAYS_PER_MONTH, WORKING_HOURS_PER_DAY);
    const [existing] = await db.select().from(labourCategories).where(and(eq(labourCategories.name, cat.name), isNull(labourCategories.companyId))).limit(1);
    const values = {
      monthlySalary: cat.monthlySalary.toString(), hourlyRate: hourlyRate.toString(), currency: "MZN" as const,
      sourceName: LABOUR_SOURCE, sourceReference: LABOUR_REFERENCE, effectiveDate: "2026-06-06", updatedAt: new Date(),
    };
    if (existing) await db.update(labourCategories).set(values).where(eq(labourCategories.id, existing.id));
    else await db.insert(labourCategories).values({ companyId: null, name: cat.name, ...values });
  }
  console.log(`catálogo de mão-de-obra revisto (${LABOUR_CATEGORIES.length} categorias)`);
}

async function seedMaterials() {
  for (const m of MATERIALS) {
    const [existing] = await db.select().from(materials).where(and(eq(materials.name, m.name), isNull(materials.companyId))).limit(1);
    const values = {
      unit: m.unit,
      baseUnitCost: m.baseUnitCost.toString(),
      importFactor: m.importFactor.toString(),
      currency: "MZN" as const,
      priceSourceName: INE_CONSTRUCTION_SOURCE,
      sourceReference: INE_CONSTRUCTION_REFERENCE,
      priceDate: PRICE_DATE,
      includesVat: false,
      purchasePackageLabel: m.purchasePackage?.label ?? null,
      purchasePackageQty: m.purchasePackage ? m.purchasePackage.qty.toString() : null,
      updatedAt: new Date(),
    };
    if (existing) await db.update(materials).set(values).where(eq(materials.id, existing.id));
    else await db.insert(materials).values({ companyId: null, name: m.name, ...values });
  }
  console.log(`catálogo de materiais revisto (${MATERIALS.length} materiais)`);
}

async function seedEquipment() {
  const [existing] = await db.select().from(equipment).limit(1);
  if (existing) {
    console.log("catálogo de máquinas já existe, a saltar");
    return;
  }
  for (const e of EQUIPMENT) {
    await db.insert(equipment).values({
      companyId: null,
      name: e.name,
      unit: e.unit,
      hourlyCost: e.hourlyCost.toString(),
      currency: "MZN",
    });
  }
  console.log(`catálogo de máquinas semeado (${EQUIPMENT.length} equipamentos)`);
}

async function seedSampleComposition() {
  const [existing] = await db.select().from(costCompositions).limit(1);
  if (existing) {
    console.log("composições de custo já existem, a saltar");
    return;
  }
  const servente = await db.select().from(labourCategories).where(eq(labourCategories.name, "Servente")).limit(1);
  const areia = await db.select().from(materials).where(eq(materials.name, "Areia grossa")).limit(1);
  if (!servente[0] || !areia[0]) return;

  const [composition] = await db
    .insert(costCompositions)
    .values({ companyId: null, name: "Escavação manual em fundações", outputUnit: "m3", currency: "MZN" })
    .returning();

  await db.insert(compositionLabourLines).values({
    compositionId: composition.id,
    labourCategoryId: servente[0].id,
    qtyPerUnit: "2.0",
  });
  await db.insert(compositionMaterialLines).values({
    compositionId: composition.id,
    materialId: areia[0].id,
    qtyPerUnit: "0.05",
  });
  console.log("composição de custo de exemplo criada: Escavação manual em fundações");
}

async function seedWorkItemTemplates() {
  const [existing] = await db.select().from(workItemTemplates).limit(1);
  if (existing) {
    console.log("catálogo de tipos de trabalho já existe, a saltar");
    return;
  }
  for (let i = 0; i < WORK_ITEM_TEMPLATES.length; i++) {
    const t = WORK_ITEM_TEMPLATES[i];
    await db.insert(workItemTemplates).values({
      companyId: null,
      chapterCode: t.chapterCode,
      chapterName: t.chapterName,
      description: t.description,
      unit: t.unit as any,
      sortOrder: i,
    });
  }
  console.log(`catálogo de tipos de trabalho semeado (${WORK_ITEM_TEMPLATES.length} itens)`);
}

async function seedPriceZones() {
  const [existing] = await db.select().from(priceZones).limit(1);
  if (existing) {
    console.log("zonas de preço já existem, a saltar");
    return;
  }
  for (const name of PRICE_ZONES) {
    await db.insert(priceZones).values({ companyId: null, name });
  }
  console.log(`zonas de preço semeadas (${PRICE_ZONES.length} zonas)`);
}

export async function seedCatalog() {
  await seedLabourCategories();
  await seedMaterials();
  await seedEquipment();
  await seedSampleComposition();
  await seedWorkItemTemplates();
  await seedPriceZones();
}
