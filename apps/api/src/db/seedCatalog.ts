import { eq } from "drizzle-orm";
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

// Salários revistos com base no salário mínimo do sector da construção civil em
// Moçambique a partir de 1 de Abril de 2026 (8.652 MT/mês) e nas bandas salariais por
// função (fonte: wageindicator.org/meusalario.org) — nenhuma categoria pode ficar abaixo
// do mínimo legal; acima disso, escalona-se por qualificação.
const LABOUR_CATEGORIES = [
  { name: "Servente", monthlySalary: 9000 },
  { name: "Carpinteiro B", monthlySalary: 10500 },
  { name: "Pedreiro A", monthlySalary: 17000 },
  { name: "Ferreiro", monthlySalary: 10500 },
  { name: "Armador de Ferro", monthlySalary: 11000 },
  { name: "Topógrafo", monthlySalary: 14000 },
];

// Cimento confirmado por pesquisa (Dez/2025-2026: saco 50kg entre 650-700 MT, preço
// disparou ~50% por escassez de matéria-prima) — mantido em 650 MT. Aço e blocos ajustados
// com uma inflação moderada equivalente, sem fonte de preço exacta encontrada online.
// `purchasePackage` (opcional): unidade de compra de mercado, quando difere da unidade de
// medida usada nas composições (ex: areia medida em m3, vendida por camião) — editável depois
// no Catálogo, por material; a dimensão real do camião/saco varia por fornecedor.
const MATERIALS = [
  { name: "Cimento (saco 50kg)", unit: "un" as const, baseUnitCost: 650, importFactor: 1, purchasePackage: { label: "Saco 50kg", qty: 1 } },
  { name: "Areia grossa", unit: "m3" as const, baseUnitCost: 900, importFactor: 1, purchasePackage: { label: "Camião 10m³", qty: 10 } },
  { name: "Areia fina", unit: "m3" as const, baseUnitCost: 900, importFactor: 1, purchasePackage: { label: "Camião 10m³", qty: 10 } },
  { name: "Brita 3/4", unit: "m3" as const, baseUnitCost: 1200, importFactor: 1, purchasePackage: { label: "Camião 10m³", qty: 10 } },
  { name: "Saibro", unit: "m3" as const, baseUnitCost: 765, importFactor: 1, purchasePackage: { label: "Camião 10m³", qty: 10 } },
  { name: "Aço A400", unit: "kg" as const, baseUnitCost: 92, importFactor: 1.05 },
  { name: "Bloco de cimento 20x20x40", unit: "un" as const, baseUnitCost: 40, importFactor: 1, purchasePackage: { label: "Palete (100 un)", qty: 100 } },
  { name: "Bloco de cimento 15x20x40", unit: "un" as const, baseUnitCost: 34, importFactor: 1, purchasePackage: { label: "Palete (100 un)", qty: 100 } },
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
  const [existing] = await db.select().from(labourCategories).limit(1);
  if (existing) {
    console.log("catálogo de mão-de-obra já existe, a saltar");
    return;
  }
  for (const cat of LABOUR_CATEGORIES) {
    const hourlyRate = computeHourlyRate(cat.monthlySalary, WORKING_DAYS_PER_MONTH, WORKING_HOURS_PER_DAY);
    await db.insert(labourCategories).values({
      companyId: null,
      name: cat.name,
      monthlySalary: cat.monthlySalary.toString(),
      hourlyRate: hourlyRate.toString(),
      currency: "MZN",
    });
  }
  console.log(`catálogo de mão-de-obra semeado (${LABOUR_CATEGORIES.length} categorias)`);
}

async function seedMaterials() {
  const [existing] = await db.select().from(materials).limit(1);
  if (existing) {
    console.log("catálogo de materiais já existe, a saltar");
    return;
  }
  for (const m of MATERIALS) {
    await db.insert(materials).values({
      companyId: null,
      name: m.name,
      unit: m.unit,
      baseUnitCost: m.baseUnitCost.toString(),
      importFactor: m.importFactor.toString(),
      currency: "MZN",
      purchasePackageLabel: m.purchasePackage?.label ?? null,
      purchasePackageQty: m.purchasePackage ? m.purchasePackage.qty.toString() : null,
    });
  }
  console.log(`catálogo de materiais semeado (${MATERIALS.length} materiais)`);
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
