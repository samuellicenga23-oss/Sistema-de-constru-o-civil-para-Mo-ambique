import { eq, isNull } from "drizzle-orm";
import { db } from "./index.js";
import { priceZones, materials, materialZonePrices } from "./schema.js";

// Expansão de zonas de preço para cobrir as capitais provinciais fora da Grande Maputo (as
// zonas da Grande Maputo já existiam em seedCatalog.ts). Cada zona tem um "índice de cimento"
// (preço do saco de 50kg / preço-base de Maputo, actualmente 650 MT) usado para derivar o preço
// dos restantes materiais volumosos/locais (areia, brita, saibro, blocos) na mesma proporção —
// e uma fracção mais suave (40% do desvio) para o aço, que é tipicamente distribuído a nível
// nacional por poucos importadores e por isso menos sensível ao transporte local.
//
// Fontes: preço do cimento é o dado mais fácil de confirmar publicamente por zona; os restantes
// materiais não têm cotação pública por província, por isso são derivados por proporção, não
// inventados isoladamente. Onde não há preço de cimento confirmado para a própria cidade,
// assume-se por extrapolação regional (marcado "estimativa" abaixo) — recomenda-se ao utilizador
// validar localmente antes de fechar uma proposta comercial numa zona nova.
const MAPUTO_CEMENT_BASE = 650;

const NEW_ZONES: { name: string; cementPrice: number; sourced: boolean; note: string }[] = [
  {
    name: "Beira (Sofala)",
    cementPrice: 680,
    sourced: true,
    note: "confirmado: saco 50kg entre 650-700 MT (pesquisa Dez/2025, mercado local)",
  },
  {
    name: "Tete (cidade)",
    cementPrice: 735,
    sourced: true,
    note: "confirmado: até 750 MT por especulação de mercado (Carta de Moçambique)",
  },
  {
    name: "Lichinga (Niassa)",
    cementPrice: 650,
    sourced: true,
    note: "confirmado: saco 50kg a 650 MT (pesquisa 2026)",
  },
  {
    name: "Pemba (Cabo Delgado)",
    cementPrice: 575,
    sourced: true,
    note: "confirmado: entre 550-600 MT na capital provincial, tendendo a subir com a distância a Pemba",
  },
  {
    name: "Nampula (cidade)",
    cementPrice: 650,
    sourced: false,
    note: "estimativa: sem cotação pública confirmada para 2026 — assume paridade com Maputo por ser grande pólo de distribuição do Norte",
  },
  {
    name: "Quelimane (Zambézia)",
    cementPrice: 680,
    sourced: false,
    note: "estimativa: extrapolado do corredor Beira-Quelimane (transporte semelhante)",
  },
  {
    name: "Chimoio (Manica)",
    cementPrice: 700,
    sourced: false,
    note: "estimativa: interior, entre o abastecimento de Beira e a especulação observada em Tete",
  },
  {
    name: "Xai-Xai (Gaza)",
    cementPrice: 660,
    sourced: false,
    note: "estimativa: corredor Sul, proximidade relativa a Maputo",
  },
  {
    name: "Inhambane (cidade)",
    cementPrice: 665,
    sourced: false,
    note: "estimativa: corredor Sul costeiro, proximidade relativa a Maputo",
  },
];

const STEEL_MATERIAL_NAME = "Aço A400";

export async function seedNationalZonePrices() {
  const globalMaterials = await db.select().from(materials).where(isNull(materials.companyId));
  if (!globalMaterials.length) {
    console.log("catálogo de materiais ainda não semeado, a saltar expansão nacional de zonas");
    return;
  }

  for (const zone of NEW_ZONES) {
    let [zoneRow] = await db.select().from(priceZones).where(eq(priceZones.name, zone.name)).limit(1);
    if (!zoneRow) {
      [zoneRow] = await db.insert(priceZones).values({ companyId: null, name: zone.name }).returning();
      console.log(`zona criada: ${zone.name} (${zone.sourced ? "fonte confirmada" : "estimativa"} — ${zone.note})`);
    }

    // Idempotente ao nível da zona: se já existir qualquer preço gravado para esta zona (seed
    // anterior, ou edição manual do utilizador no Catálogo), não se mexe mais nela.
    const [existingForZone] = await db
      .select()
      .from(materialZonePrices)
      .where(eq(materialZonePrices.zoneId, zoneRow.id))
      .limit(1);
    if (existingForZone) continue;

    const ratio = zone.cementPrice / MAPUTO_CEMENT_BASE;

    for (const material of globalMaterials) {
      const appliedRatio = material.name === STEEL_MATERIAL_NAME ? 1 + (ratio - 1) * 0.4 : ratio;
      const zoneCost = Number(material.baseUnitCost) * appliedRatio;
      await db.insert(materialZonePrices).values({
        materialId: material.id,
        zoneId: zoneRow.id,
        unitCost: zoneCost.toFixed(4),
      });
    }
  }
  console.log(`zonas nacionais expandidas: ${NEW_ZONES.length} novas zonas com preços derivados`);
}
