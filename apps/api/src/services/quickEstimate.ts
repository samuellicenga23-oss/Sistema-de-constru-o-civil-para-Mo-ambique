import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems, measurementLines, budgetDocuments } from "../db/schema.js";
import { STANDARD_CHAPTERS } from "./boqTemplate.js";
import { computeSlabRebarWeightLines, DEFAULT_SLAB_LAP_FACTOR, rebarWeightPerMeter } from "@sigo/shared";

// Motor de estimativa rápida de medições: a partir de parâmetros simples do edifício
// (pisos, pé-direito, perímetro, lista de compartimentos), calcula quantidades aproximadas
// para os itens do Mapa de Quantidades padrão (ver boqTemplate.ts) e grava-as como uma
// medição única por item. NÃO substitui um levantamento real — é um ponto de partida rápido,
// sempre revisável depois item a item (cada linha fica identificada como "estimativa
// automática" e a origem do item passa a "planta" para se distinguir de medições manuais).
//
// Fórmulas e rácios usados são aproximações genéricas de mercado para construção residencial
// em betão armado — documentadas em cada bloco de cálculo abaixo.

export type RoomInput = { name: string; type: "seco" | "humido"; length: number; width: number; perimeterM?: number };
export type FloorInput = { label?: string; ceilingHeight: number; perimeter: number; rooms: RoomInput[] };
export type SlabRebarLayerInput = { xDiameterMm: number; xSpacingCm: number; yDiameterMm: number; ySpacingCm: number };
export type FloorSlabInput = {
  label: string;
  areaM2: number;
  thicknessM: number;
  topRebar?: SlabRebarLayerInput | null;
  bottomRebar?: SlabRebarLayerInput | null;
};
export type OpeningInput = {
  kind: "porta" | "janela";
  widthM: number;
  heightM: number;
  quantity: number;
  location: "interior" | "exterior" | "desconhecida";
  confirmed: boolean;
};
export type FoundationType = "sapata_isolada" | "sapata_corrida" | "laje";
export type RoofType = "laje_plana" | "chapa_metalica";
export type MeasurementScope = "preliminares" | "terraplenagem" | "estrutura" | "arquitectura" | "drenagem" | "cobertura" | "hidraulica" | "electricidade" | "vaos";

const SCOPE_CHAPTER_CODES: Record<MeasurementScope, string[]> = {
  preliminares: ["1"], terraplenagem: ["2"], estrutura: ["3"],
  arquitectura: ["4", "5", "6", "7"], drenagem: ["8", "9"],
  cobertura: ["10"], hidraulica: ["11"], electricidade: ["13"], vaos: ["15"],
};

function selectedChapterCodes(scopes?: MeasurementScope[]): Set<string> {
  const selected = scopes?.length ? scopes : (Object.keys(SCOPE_CHAPTER_CODES) as MeasurementScope[]);
  return new Set(selected.flatMap((scope) => SCOPE_CHAPTER_CODES[scope]));
}

// Sapatas isoladas/corridas: contadas uma a uma (nº, área e profundidade médias) — mais
// preciso do que estimar por um rácio genérico da área do piso térreo. Fundação em laje:
// não há sapatas discretas, só a espessura da própria laje de fundação.
export type FootingDetail = { count: number; avgArea: number; avgDepth: number };

// Dimensionamento de fossa séptica e vala/poço de infiltração por nº de pessoas — método de
// Bartolomeu (1996)/Morais (1962), tal como reproduzido no "Guia Técnico – Sistemas de
// Saneamento de Pequenos Aglomerados Populacionais" (ERSARA) e na tese "Sistemas de saneamento
// local de baixo custo" (Guerreiro, IST-ULisboa) — a mesma base de cálculo usada em Portugal e em
// Moçambique para saneamento autónomo, apenas com uma capitação (L/pessoa/dia) mais baixa no
// contexto moçambicano. NOTA: apesar de o "Regulamento Geral dos Sistemas Públicos e Prediais de
// Distribuição de Água e de Drenagem de Águas Residuais" (Decreto Regulamentar 23/95) ser a base
// legal citada nos projectos hidráulicos, o próprio decreto não contém estas tabelas — os números
// vêm de Morais/Bartolomeu, é essa a fonte a citar.
export type SoilType = "areia_grossa" | "areia_fina" | "argila_arenosa" | "argila_compacta";
export type SepticTankInput = {
  numberOfPeople: number;
  dailyFlowLPerPerson: number; // capitação: 20 (sem ligação domiciliária) / 60 (torneira no quintal) / 100 (canalização interior)
  soilType: SoilType;
};

// Capitação de lamas frescas e digeridas, tempo de digestão e intervalo entre limpezas — fixos
// pelo método (não variam com a capitação de água usada, que é só para o volume líquido).
const SLUDGE_FRESH_CAPITATION_L = 0.45; // L/pessoa/dia
const SLUDGE_DIGESTED_CAPITATION_L = 0.11; // L/pessoa/dia
const DIGESTION_TIME_DAYS = 60;
const DESLUDGING_INTERVAL_DAYS = 365;
const MIN_TANK_VOLUME_L = 3000; // capacidade mínima prática (Morais 1962)

export function computeSepticTankVolumeM3(numberOfPeople: number, dailyFlowLPerPerson: number): { volumeM3: number; compartments: number } {
  const retentionDays = numberOfPeople <= 60 ? 3 : 2;
  const liquidVolume = dailyFlowLPerPerson * numberOfPeople * retentionDays;
  const digestedSludgeVolume = SLUDGE_DIGESTED_CAPITATION_L * numberOfPeople * (DESLUDGING_INTERVAL_DAYS - DIGESTION_TIME_DAYS);
  const digestingSludgeVolume = (SLUDGE_FRESH_CAPITATION_L * numberOfPeople * DIGESTION_TIME_DAYS) / 2;
  const totalVolumeL = Math.max(liquidVolume + digestedSludgeVolume + digestingSludgeVolume, MIN_TANK_VOLUME_L);
  return { volumeM3: totalVolumeL / 1000, compartments: numberOfPeople < 20 ? 2 : 3 };
}

// Área de infiltração necessária por pessoa, por tipo de solo (tabela simplificada, capitação até
// 100 L/pessoa/dia) — argila compacta não tem solução por infiltração simples (null).
const INFILTRATION_AREA_PER_PERSON_M2: Record<SoilType, number | null> = {
  areia_grossa: 1.5,
  areia_fina: 2.5,
  argila_arenosa: 5,
  argila_compacta: null,
};

export function computeInfiltrationAreaM2(numberOfPeople: number, soilType: SoilType): number | null {
  const areaPerPerson = INFILTRATION_AREA_PER_PERSON_M2[soilType];
  return areaPerPerson === null ? null : numberOfPeople * areaPerPerson;
}

export const SOIL_TYPE_LABELS: Record<SoilType, string> = {
  areia_grossa: "Areia grossa / godo",
  areia_fina: "Areia fina",
  argila_arenosa: "Argila com elevado teor de areia",
  argila_compacta: "Argila compacta",
};

export type HydraulicInput = {
  toilets: number;
  sinks: number;
  showers: number;
  kitchenSinks: number;
  laundryTanks: number;
  hasWaterTank: boolean;
  // Nº de caixas de visita/inspecção de esgotos — ao contrário dos comprimentos de tubo (que
  // têm um rácio genérico por compartimento húmido), não há um rácio de mercado sensato para
  // isto: depende do traçado da rede (mudanças de direcção, distância entre troços), por isso
  // pede-se sempre directamente ao utilizador, sem valor por omissão diferente de 0.
  manholeCount: number;
};

export type QuickEstimateInput = {
  scopes?: MeasurementScope[];
  floors?: FloorInput[];
  foundationType?: FoundationType;
  footing?: FootingDetail; // obrigatório para sapata_isolada/sapata_corrida
  slabThickness?: number; // obrigatório para foundationType === "laje" (m)
  concreteClass?: "B20" | "B25" | "B30";
  roofType?: RoofType;
  roofArea?: number; // se omitido, estima-se a partir da área do último piso
  steelWeightKg?: number; // se vier de um projecto estrutural real, substitui o rácio kg/m3
  beamConcreteVolumeM3?: number; // idem, calculado a partir do comprimento×secção reais das vigas
  floorSlabThicknessM?: number; // compatibilidade com medições antigas de espessura única
  floorSlabs?: FloorSlabInput[]; // cada laje física mantém área e espessura próprias
  pavementReinforcement?: "bars_6_20" | "welded_mesh" | "none";
  foundationMembrane?: boolean;
  groundBeam?: { enabled: boolean; lengthM?: number; longitudinalBars?: number; diameterMm?: number };
  openings?: OpeningInput[];
  hydraulic?: HydraulicInput;
  // Opcional: só quando o projecto usa saneamento autónomo (sem ligação à rede pública de
  // esgotos) — dimensiona a fossa séptica e a vala/poço de infiltração a partir do nº de pessoas.
  septicTank?: SepticTankInput;
  // Ajustes avançados opcionais: itens que por omissão usam sempre um rácio genérico (nenhuma
  // planta dá estes dados directamente) — quando o utilizador souber o valor real para este
  // edifício, substitui o rácio e a origem passa a "medido" em vez de "estimativa".
  columnConcreteVolumeM3?: number; // 3.3 betão em pilares
  formworkAreaM2?: number; // 3.8 cofragem
  backfillEarthVolumeM3?: number; // 2.3 aterro com terras de empréstimo
  sewerPipe110M?: number; // 8.1 tubagem de esgoto Ø110mm
  sewerPipe40M?: number; // 8.2 tubagem de esgoto Ø40mm
  downpipeLengthM?: number; // 9.1 tubo de queda pluvial
  waterSupplyPipeM?: number; // 11.6 rede de distribuição de água fria
};

// Margem de escavação em torno de cada sapata (espaço de trabalho para cofragem/pessoal).
const FOOTING_EXCAVATION_MARGIN = 1.2;
// Metros lineares médios de tubo por cada ponto de água servido (ramal + parte da coluna).
const PIPE_RUN_PER_FIXTURE = 5;

// Relatório de cálculos: para cada item gerado, regista a fórmula usada (com os números reais
// substituídos) e classifica a origem do dado em 3 níveis, para nenhuma quantidade ficar "às
// cegas" sem se saber de onde veio:
// - "real": veio de dados extraídos de uma planta (estrutural ou arquitectura) importada.
// - "medido": veio directamente de valores que o utilizador indicou no Assistente para este
//   edifício em concreto (dimensões de compartimentos, nº de aparelhos, área de cobertura) —
//   não é uma medição topográfica, mas também não é um rácio genérico não verificado.
// - "estimativa": rácio de engenharia genérico de mercado, usado só porque não havia nenhum
//   dado mais específico disponível para este edifício.
export type CalculationSource = "real" | "medido" | "estimativa";
export type CalculationReportEntry = {
  code: string;
  label: string;
  unit: string;
  value: number;
  source: CalculationSource;
  formula: string;
};

const TEMPLATE_ITEM_BY_CODE = new Map(STANDARD_CHAPTERS.flatMap((c) => c.items.map((i) => [i.code, i])));

function fmt(n: number): string {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roomArea(r: RoomInput) {
  return r.length * r.width;
}
function roomPerimeter(r: RoomInput) {
  return r.perimeterM && r.perimeterM > 0 ? r.perimeterM : 2 * (r.length + r.width);
}

export function computeQuantities(input: QuickEstimateInput) {
  const floors = input.floors ?? [];
  const emptyFloor: FloorInput = { label: "Sem geometria", ceilingHeight: 0, perimeter: 0, rooms: [] };
  const groundFloor = floors[0] ?? emptyFloor;
  const topFloor = floors[floors.length - 1] ?? emptyFloor;

  const groundFloorArea = groundFloor.rooms.reduce((s, r) => s + roomArea(r), 0);
  const topFloorArea = topFloor.rooms.reduce((s, r) => s + roomArea(r), 0);
  const roofArea = input.roofArea ?? topFloorArea * 1.1;
  const totalBuiltArea = floors.reduce((s, f) => s + f.rooms.reduce((s2, r) => s2 + roomArea(r), 0), 0);
  const totalRooms = floors.reduce((s, f) => s + f.rooms.length, 0);

  let totalExteriorWallArea = 0;
  let totalInteriorWallArea = 0;
  let totalInteriorFinishWallArea = 0; // ambas as faces — para reboco/pintura
  let wetFloorArea = 0;
  let wetWallArea = 0;
  let wetRoomsCount = 0;

  for (const floor of floors) {
    const floorWallArea = floor.rooms.reduce((s, r) => s + roomPerimeter(r) * floor.ceilingHeight, 0);
    const floorExteriorWallArea = floor.perimeter * floor.ceilingHeight;
    const floorInteriorWallArea = Math.max(0, floorWallArea - floorExteriorWallArea) / 2;

    totalExteriorWallArea += floorExteriorWallArea;
    totalInteriorWallArea += floorInteriorWallArea;
    totalInteriorFinishWallArea += floorWallArea;

    for (const room of floor.rooms) {
      if (room.type === "humido") {
        wetRoomsCount++;
        wetFloorArea += roomArea(room);
        wetWallArea += roomPerimeter(room) * floor.ceilingHeight;
      }
    }
  }

  // Só dados confirmados descontam paredes. Um candidato ambíguo permanece no ecrã de revisão,
  // mas não altera silenciosamente alvenaria, reboco ou pintura.
  const confirmedOpenings = (input.openings ?? []).filter((opening) => opening.confirmed && opening.location !== "desconhecida");
  const exteriorOpeningArea = confirmedOpenings
    .filter((opening) => opening.location === "exterior")
    .reduce((sum, opening) => sum + opening.widthM * opening.heightM * opening.quantity, 0);
  const interiorOpeningArea = confirmedOpenings
    .filter((opening) => opening.location === "interior")
    .reduce((sum, opening) => sum + opening.widthM * opening.heightM * opening.quantity, 0);
  const grossExteriorWallArea = totalExteriorWallArea;
  const grossInteriorWallArea = totalInteriorWallArea;
  totalExteriorWallArea = Math.max(0, totalExteriorWallArea - exteriorOpeningArea);
  totalInteriorWallArea = Math.max(0, totalInteriorWallArea - interiorOpeningArea);
  totalInteriorFinishWallArea = Math.max(0, totalInteriorFinishWallArea - exteriorOpeningArea - interiorOpeningArea * 2);
  const interiorDoors = confirmedOpenings.filter((opening) => opening.kind === "porta" && opening.location === "interior").reduce((sum, opening) => sum + opening.quantity, 0);
  const exteriorDoors = confirmedOpenings.filter((opening) => opening.kind === "porta" && opening.location === "exterior").reduce((sum, opening) => sum + opening.quantity, 0);
  const windowArea = confirmedOpenings.filter((opening) => opening.kind === "janela").reduce((sum, opening) => sum + opening.widthM * opening.heightM * opening.quantity, 0);
  const openingLintelLength = confirmedOpenings.reduce((sum, opening) => sum + opening.widthM * opening.quantity, 0);

  // Estrutura: rácios genéricos m3 betão / m2 construído e kg aço / m3 betão para
  // edifícios residenciais correntes em betão armado — ajustar depois item a item.
  const concreteVolume = totalBuiltArea * 0.12;
  const concreteStructural = concreteVolume * 0.95;
  const detailedSlabSteelLines = (input.floorSlabs ?? []).flatMap((slab) => {
    const layers = [
      slab.bottomRebar ? {
        label: `${slab.label} inferior`,
        directions: [
          { role: "X", diameterMm: slab.bottomRebar.xDiameterMm, spacingCm: slab.bottomRebar.xSpacingCm },
          { role: "Y", diameterMm: slab.bottomRebar.yDiameterMm, spacingCm: slab.bottomRebar.ySpacingCm },
        ],
      } : null,
      slab.topRebar ? {
        label: `${slab.label} superior`,
        directions: [
          { role: "X", diameterMm: slab.topRebar.xDiameterMm, spacingCm: slab.topRebar.xSpacingCm },
          { role: "Y", diameterMm: slab.topRebar.yDiameterMm, spacingCm: slab.topRebar.ySpacingCm },
        ],
      } : null,
    ].filter((layer): layer is NonNullable<typeof layer> => layer !== null);
    return computeSlabRebarWeightLines({ areaM2: slab.areaM2, layers, lapFactor: DEFAULT_SLAB_LAP_FACTOR });
  });
  const detailedSlabSteelWeight = detailedSlabSteelLines.reduce((sum, line) => sum + line.weightKg, 0);

  // Pavimento térreo: premissa de orçamento, não dimensionamento estrutural. O utilizador
  // escolhe varão Ø6/20 nas duas direcções, malha electrossoldada ou nenhuma armadura.
  const pavementReinforcement = input.pavementReinforcement ?? "bars_6_20";
  const pavementBarLines = pavementReinforcement === "bars_6_20"
    ? computeSlabRebarWeightLines({
        areaM2: groundFloorArea,
        layers: [{
          label: "pavimento térreo",
          directions: [
            { role: "X", diameterMm: 6, spacingCm: 20 },
            { role: "Y", diameterMm: 6, spacingCm: 20 },
          ],
        }],
        lapFactor: DEFAULT_SLAB_LAP_FACTOR,
      })
    : [];
  const pavementBarWeight = pavementBarLines.reduce((sum, line) => sum + line.weightKg, 0);
  const groundBeamEnabled = input.groundBeam?.enabled ?? true;
  const groundBeamLengthM = input.groundBeam?.lengthM ?? groundFloor.perimeter;
  const groundBeamBars = input.groundBeam?.longitudinalBars ?? 4;
  const groundBeamDiameterMm = input.groundBeam?.diameterMm ?? 8;
  const groundBeamLongitudinalWeight = groundBeamEnabled
    ? groundBeamLengthM * groundBeamBars * rebarWeightPerMeter(groundBeamDiameterMm) * DEFAULT_SLAB_LAP_FACTOR
    : 0;
  const genericStructuralSteelWeight = concreteStructural * 80;
  // Quando só a armadura das lajes foi lida, ela funciona como mínimo auditável;
  // os restantes elementos continuam cobertos pela estimativa global até existir mapa de aço.
  const estimatedSteelBase = Math.max(genericStructuralSteelWeight, detailedSlabSteelWeight);
  // Um mapa de aço explícito já representa o projecto completo e nunca recebe acréscimos
  // silenciosos. As premissas de pavimento/viga só complementam a estimativa sem mapa.
  const steelWeight = input.steelWeightKg ?? estimatedSteelBase + pavementBarWeight + groundBeamLongitudinalWeight;
  const formworkArea = concreteStructural * 6;
  // Vigas: quando há dados reais do projecto estrutural (comprimento × secção de cada vão),
  // usa-se esse volume directamente em vez do rácio genérico.
  const beamConcreteVolume = input.beamConcreteVolumeM3 ?? concreteVolume * 0.24;
  // Lajes: quando há espessura real (das folhas de armadura de piso/cobertura), o volume é
  // área total construída × espessura real, em vez do rácio genérico.
  const slabConcreteVolume = input.floorSlabs?.length
    ? input.floorSlabs.reduce((sum, slab) => sum + slab.areaM2 * slab.thicknessM, 0)
    : input.floorSlabThicknessM
      ? totalBuiltArea * input.floorSlabThicknessM
      : concreteVolume * 0.33;

  // Volume de betão em sapatas/fundação: a partir de dados contados (nº × área ×
  // profundidade), não de um rácio genérico da área do piso térreo — mais preciso quando
  // o utilizador sabe (ou o projectista indicou) estes valores.
  let footingConcreteVolume: number;
  let excavationVolume: number;
  const foundationType = input.foundationType ?? "sapata_isolada";
  const roofType = input.roofType ?? "laje_plana";
  if (foundationType === "laje") {
    const thickness = input.slabThickness ?? 0.35;
    footingConcreteVolume = groundFloorArea * thickness;
    excavationVolume = footingConcreteVolume * FOOTING_EXCAVATION_MARGIN;
  } else {
    const f = input.footing ?? { count: 1, avgArea: groundFloorArea * 0.15, avgDepth: 0.2 };
    footingConcreteVolume = f.count * f.avgArea * f.avgDepth;
    excavationVolume = footingConcreteVolume * FOOTING_EXCAVATION_MARGIN;
  }
  const backfillVolume = Math.max(0, excavationVolume - footingConcreteVolume);

  const avgCeilingHeight = floors.length ? floors.reduce((s, f) => s + f.ceilingHeight, 0) / floors.length : 0;
  const avgPerimeter = floors.length ? floors.reduce((s, f) => s + f.perimeter, 0) / floors.length : 0;
  const downpipeCount = Math.max(1, Math.round(avgPerimeter / 12));

  const h = input.hydraulic;
  const totalFixtures = h ? h.toilets + h.sinks + h.showers + h.kitchenSinks + h.laundryTanks : 0;

  const septic = input.septicTank;
  const septicTankResult = septic ? computeSepticTankVolumeM3(septic.numberOfPeople, septic.dailyFlowLPerPerson) : null;
  const infiltrationAreaM2 = septic ? computeInfiltrationAreaM2(septic.numberOfPeople, septic.soilType) : null;

  // Origem/fórmula da fundação — reaproveitada nos itens 2.1/2.2/3.1/3.2, que partilham a
  // mesma base de cálculo (volume de betão de fundação e a escavação à sua volta).
  let footingSource: CalculationSource;
  let footingFormula: string;
  if (foundationType === "laje") {
    footingSource = input.slabThickness !== undefined ? "medido" : "estimativa";
    const thickness = input.slabThickness ?? 0.35;
    footingFormula = `Área do piso térreo (${fmt(groundFloorArea)} m²) × espessura da laje de fundação (${fmt(thickness)} m${input.slabThickness === undefined ? ", valor por omissão — não indicado" : ""})`;
  } else {
    const f = input.footing;
    footingSource = f ? "real" : "estimativa";
    const used = f ?? { count: 1, avgArea: groundFloorArea * 0.15, avgDepth: 0.2 };
    footingFormula = f
      ? `${used.count} sapata(s) × ${fmt(used.avgArea)} m² (área média) × ${fmt(used.avgDepth)} m (profundidade média) — dados confirmados no Assistente de Medições`
      : `${used.count} sapata × ${fmt(used.avgArea)} m² × ${fmt(used.avgDepth)} m — valores por omissão, sem planta estrutural nem contagem indicada`;
  }
  const beamSource: CalculationSource = input.beamConcreteVolumeM3 !== undefined ? "real" : "estimativa";
  const slabSource: CalculationSource = input.floorSlabs?.length || input.floorSlabThicknessM !== undefined ? "real" : "estimativa";
  const steelSource: CalculationSource = input.steelWeightKg !== undefined ? "real" : "estimativa";

  const report: CalculationReportEntry[] = [];
  function push(code: string, value: number, source: CalculationSource, formula: string) {
    const meta = TEMPLATE_ITEM_BY_CODE.get(code);
    report.push({ code, label: meta?.description ?? code, unit: meta?.unit ?? "", value, source, formula });
  }

  // code -> { quantity, unit } — código tal como gerado por boqTemplate.ts.
  const byCode: Record<string, number> = {
    "1.1": groundFloorArea * 1.1,
    "1.2": groundFloor.perimeter * 1.2,
    "1.3": groundFloorArea * 1.1,

    "2.1": excavationVolume,
    "2.2": backfillVolume,
    "2.3": input.backfillEarthVolumeM3 ?? groundFloorArea * 0.5,
    // Enrocamento é m³: área × espessura típica do leito (15 cm sob pavimento/fundações).
    "2.4": groundFloorArea * 0.15,
    "2.5": input.foundationMembrane === false ? 0 : groundFloorArea,

    "3.1": footingConcreteVolume * 0.15,
    "3.2": footingConcreteVolume,
    "3.3": input.columnConcreteVolumeM3 ?? concreteVolume * 0.19,
    "3.4": beamConcreteVolume,
    "3.5": slabConcreteVolume,
    "3.6": steelWeight,
    "3.7": pavementReinforcement === "welded_mesh" ? groundFloorArea * DEFAULT_SLAB_LAP_FACTOR : 0,
    "3.8": input.formworkAreaM2 ?? formworkArea,

    "4.1": totalExteriorWallArea,
    "4.2": totalInteriorWallArea,

    "5.1": totalBuiltArea,
    "5.2": totalInteriorFinishWallArea,
    "5.3": totalExteriorWallArea,

    "6.1": wetFloorArea,
    "6.2": wetWallArea,

    "7.1": totalExteriorWallArea,
    "7.2": Math.max(0, totalInteriorFinishWallArea - wetWallArea),
    "7.3": totalBuiltArea,

    "8.1": input.sewerPipe110M ?? wetRoomsCount * 4,
    "8.2": input.sewerPipe40M ?? wetRoomsCount * 3,
    "8.3": h?.manholeCount ?? 0,

    "9.1": input.downpipeLengthM ?? downpipeCount * avgCeilingHeight * floors.length,

    "10.1": roofType_isFlat(roofType) ? roofArea : 0,
    "10.2": roofType_isFlat(roofType) ? 0 : roofArea,
    "10.3": roofType_isFlat(roofType) ? 0 : avgPerimeter * 0.6,

    "11.1": h?.toilets ?? 0,
    "11.2": h?.sinks ?? 0,
    "11.3": h?.showers ?? 0,
    "11.4": h?.kitchenSinks ?? 0,
    "11.5": h?.laundryTanks ?? 0,
    "11.6": input.waterSupplyPipeM ?? totalFixtures * PIPE_RUN_PER_FIXTURE,
    "11.7": h?.hasWaterTank ? 1 : 0,

    "12.1": septicTankResult?.volumeM3 ?? 0,
    "12.2": infiltrationAreaM2 ?? 0,

    // Eléctricas — rácios de pré-dimensionamento (não substituem projecto eléctrico).
    "13.1": totalRooms > 0 ? 1 : 0,
    "13.2": totalRooms > 0 ? Math.max(totalRooms, Math.round(totalBuiltArea / 12)) : 0,
    "13.3": totalRooms > 0 ? Math.max(totalRooms * 2, Math.round(totalBuiltArea / 8)) : 0,
    "13.4": totalRooms > 0 ? 1 : 0,

    "15.1": interiorDoors,
    "15.2": exteriorDoors,
    "15.3": windowArea,
    "15.4": openingLintelLength,
  };

  const roofFormula = `Área de cobertura indicada no Assistente: ${fmt(roofArea)} m² (${input.roofArea !== undefined ? "confirmada/ajustada pelo utilizador" : `sugerida = área do último piso ${fmt(topFloorArea)} m² × 1.10`})`;

  push("1.1", byCode["1.1"], "medido", `Área do piso térreo (${fmt(groundFloorArea)} m²) × 1.10 (margem de limpeza em torno da construção)`);
  push("1.2", byCode["1.2"], "medido", `Perímetro do piso térreo (${fmt(groundFloor.perimeter)} m) × 1.20 (margem de cangalho)`);
  push("1.3", byCode["1.3"], "medido", `Área do piso térreo (${fmt(groundFloorArea)} m²) × 1.10 (margem de tratamento do solo)`);

  push("2.1", byCode["2.1"], footingSource, `${footingFormula} × ${FOOTING_EXCAVATION_MARGIN} (margem de escavação)`);
  push("2.2", byCode["2.2"], footingSource, `Volume de escavação (${fmt(excavationVolume)} m³) − volume de betão de fundação (${fmt(footingConcreteVolume)} m³)`);
  push(
    "2.3",
    byCode["2.3"],
    input.backfillEarthVolumeM3 !== undefined ? "medido" : "estimativa",
    input.backfillEarthVolumeM3 !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.backfillEarthVolumeM3)} m³`
      : `Área do piso térreo (${fmt(groundFloorArea)} m²) × 0.50 (rácio genérico de enrocamento — sem dado real de espessura do leito)`
  );
  push(
    "2.4",
    byCode["2.4"],
    "estimativa",
    `Área do piso térreo (${fmt(groundFloorArea)} m²) × 0.15 m (espessura típica do leito de enrocamento)`,
  );
  push(
    "2.5",
    byCode["2.5"],
    input.foundationMembrane === false ? "medido" : "estimativa",
    input.foundationMembrane === false
      ? "Membrana desactivada pelo utilizador"
      : `Área do piso térreo (${fmt(groundFloorArea)} m²) — plástico/membrana sob o pavimento como premissa confirmável`,
  );

  push("3.1", byCode["3.1"], footingSource, `Volume de betão de fundação (${fmt(footingConcreteVolume)} m³) × 0.15 (rácio genérico de betão de limpeza)`);
  push("3.2", byCode["3.2"], footingSource, footingFormula);
  push(
    "3.3",
    byCode["3.3"],
    input.columnConcreteVolumeM3 !== undefined ? "medido" : "estimativa",
    input.columnConcreteVolumeM3 !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.columnConcreteVolumeM3)} m³`
      : `Volume estrutural total (${fmt(concreteVolume)} m³, 12% da área construída) × 0.19 (rácio genérico de pilares — a secção real de cada pilar não vem como um dado limpo neste tipo de ficheiro estrutural)`
  );
  push(
    "3.4",
    byCode["3.4"],
    beamSource,
    beamSource === "real"
      ? `Volume de vigas indicado ou confirmado no Assistente de Medições: ${fmt(beamConcreteVolume)} m³`
      : `Volume estrutural total (${fmt(concreteVolume)} m³) × 0.24 (rácio genérico de vigas — sem planta estrutural com dados de vigas)`
  );
  push(
    "3.5",
    byCode["3.5"],
    slabSource,
    slabSource === "real"
      ? input.floorSlabs?.length
        ? input.floorSlabs.map((slab) => `${slab.label}: ${fmt(slab.areaM2)} m² × ${fmt(slab.thicknessM)} m`).join(" + ")
        : `Área construída total (${fmt(totalBuiltArea)} m²) × espessura da laje (${fmt(input.floorSlabThicknessM ?? 0)} m, indicada ou confirmada no Assistente)`
      : `Volume estrutural total (${fmt(concreteVolume)} m³) × 0.33 (rácio genérico de lajes — sem planta estrutural com espessura real)`
  );
  push(
    "3.6",
    byCode["3.6"],
    steelSource,
    steelSource === "real"
      ? `Peso total de aço indicado ou confirmado no Assistente de Medições: ${fmt(steelWeight)} kg`
      : [
          `Estimativa estrutural base: ${fmt(estimatedSteelBase)} kg`,
          detailedSlabSteelWeight > 0 ? `armadura de lajes lida: ${fmt(detailedSlabSteelWeight)} kg (mínimo auditável)` : "armadura de lajes sem mapa completo",
          pavementReinforcement === "bars_6_20" ? `pavimento Ø6/20 X+Y: ${fmt(pavementBarWeight)} kg` : "pavimento sem varão avulso",
          groundBeamEnabled ? `viga de pavimento ${groundBeamBars}Ø${groundBeamDiameterMm}: ${fmt(groundBeamLongitudinalWeight)} kg em ${fmt(groundBeamLengthM)} m (sem estribos não especificados)` : "viga de pavimento desactivada",
        ].join("; ")
  );
  push(
    "3.7",
    byCode["3.7"],
    pavementReinforcement === "welded_mesh" ? "estimativa" : "medido",
    pavementReinforcement === "welded_mesh"
      ? `Área do pavimento térreo (${fmt(groundFloorArea)} m²) × ${DEFAULT_SLAB_LAP_FACTOR.toFixed(2)} para recortes/sobreposição`
      : pavementReinforcement === "bars_6_20"
        ? "Pavimento armado com varão Ø6/20 em X+Y; quantidade incluída no aço A400"
        : "Pavimento sem malha seleccionada",
  );
  push(
    "3.8",
    byCode["3.8"],
    input.formworkAreaM2 !== undefined ? "medido" : "estimativa",
    input.formworkAreaM2 !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.formworkAreaM2)} m²`
      : `Volume estrutural de betão (${fmt(concreteStructural)} m³) × 6 m²/m³ (rácio genérico de cofragem)`
  );

  push("4.1", byCode["4.1"], "medido", `Parede exterior bruta (${fmt(grossExteriorWallArea)} m²) − vãos exteriores confirmados (${fmt(exteriorOpeningArea)} m²)`);
  push("4.2", byCode["4.2"], "medido", `Parede interior bruta (${fmt(grossInteriorWallArea)} m²) − vãos interiores confirmados (${fmt(interiorOpeningArea)} m²)`);

  push("5.1", byCode["5.1"], "medido", `Soma da área de todos os compartimentos de todos os pisos: ${fmt(totalBuiltArea)} m²`);
  push("5.2", byCode["5.2"], "medido", `Área de paredes interiores e exteriores (ambas as faces), somada por todos os pisos`);
  push("5.3", byCode["5.3"], "medido", `Área de paredes exteriores (perímetro × pé-direito), somada por todos os pisos`);

  push("6.1", byCode["6.1"], "medido", `Soma da área dos compartimentos marcados "húmido" no Assistente: ${fmt(wetFloorArea)} m²`);
  push("6.2", byCode["6.2"], "medido", `Soma da área de paredes dos compartimentos "húmidos" (perímetro × pé-direito)`);

  push("7.1", byCode["7.1"], "medido", `Área de paredes exteriores (perímetro × pé-direito), somada por todos os pisos`);
  push("7.2", byCode["7.2"], "medido", `Área de paredes interiores (ambas as faces) menos a área de paredes dos compartimentos húmidos`);
  push("7.3", byCode["7.3"], "medido", `Soma da área de todos os compartimentos de todos os pisos: ${fmt(totalBuiltArea)} m²`);

  push(
    "8.1",
    byCode["8.1"],
    input.sewerPipe110M !== undefined ? "medido" : "estimativa",
    input.sewerPipe110M !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.sewerPipe110M)} ml`
      : `${wetRoomsCount} compartimento(s) húmido(s) × 4 ml (rácio genérico de tubagem Ø110mm por compartimento)`
  );
  push(
    "8.2",
    byCode["8.2"],
    input.sewerPipe40M !== undefined ? "medido" : "estimativa",
    input.sewerPipe40M !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.sewerPipe40M)} ml`
      : `${wetRoomsCount} compartimento(s) húmido(s) × 3 ml (rácio genérico de tubagem Ø40mm por compartimento)`
  );
  push("8.3", byCode["8.3"], "medido", `Nº de caixas de visita/inspecção indicado no Assistente (Passo Hidráulica): ${h?.manholeCount ?? 0}`);

  push(
    "9.1",
    byCode["9.1"],
    input.downpipeLengthM !== undefined ? "medido" : "estimativa",
    input.downpipeLengthM !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.downpipeLengthM)} m`
      : `${downpipeCount} tubo(s) de queda (1 por cada 12m de perímetro médio, ${fmt(avgPerimeter)} m) × ${fmt(avgCeilingHeight)} m (pé-direito médio) × ${floors.length} piso(s)`
  );

  push("10.1", byCode["10.1"], "medido", roofType_isFlat(roofType) ? roofFormula : "Cobertura leve (chapa metálica) — não leva impermeabilização de laje");
  push("10.2", byCode["10.2"], "medido", roofType_isFlat(roofType) ? "Laje plana — não leva chapa metálica" : roofFormula);
  push(
    "10.3",
    byCode["10.3"],
    roofType_isFlat(roofType) ? "medido" : "estimativa",
    roofType_isFlat(roofType) ? "Laje plana — não leva cumeeira/remates de chapa" : `Perímetro médio (${fmt(avgPerimeter)} m) × 0.60 (rácio genérico de cumeeira/remates)`
  );

  push("11.1", byCode["11.1"], "medido", `Nº de sanitas indicado no Assistente (Passo Hidráulica): ${h?.toilets ?? 0}`);
  push("11.2", byCode["11.2"], "medido", `Nº de lavatórios indicado no Assistente (Passo Hidráulica): ${h?.sinks ?? 0}`);
  push("11.3", byCode["11.3"], "medido", `Nº de duches/chuveiros indicado no Assistente (Passo Hidráulica): ${h?.showers ?? 0}`);
  push("11.4", byCode["11.4"], "medido", `Nº de pias de cozinha indicado no Assistente (Passo Hidráulica): ${h?.kitchenSinks ?? 0}`);
  push("11.5", byCode["11.5"], "medido", `Nº de tanques de lavandaria indicado no Assistente (Passo Hidráulica): ${h?.laundryTanks ?? 0}`);
  push(
    "11.6",
    byCode["11.6"],
    input.waterSupplyPipeM !== undefined ? "medido" : "estimativa",
    input.waterSupplyPipeM !== undefined
      ? `Valor indicado no Assistente (ajuste avançado): ${fmt(input.waterSupplyPipeM)} ml`
      : `${totalFixtures} aparelho(s) servido(s) × 5 ml (rácio genérico de tubo de distribuição por aparelho)`
  );
  push("11.7", byCode["11.7"], "medido", `Reservatório de água indicado no Assistente (Passo Hidráulica): ${h?.hasWaterTank ? "sim" : "não"}`);

  if (septic && septicTankResult) {
    const retentionDays = septic.numberOfPeople <= 60 ? 3 : 2;
    push(
      "12.1",
      byCode["12.1"],
      "medido",
      `${septic.numberOfPeople} pessoa(s) × ${fmt(septic.dailyFlowLPerPerson)} L/pessoa/dia × ${retentionDays} dias (retenção) + lamas digeridas/em digestão, com mínimo prático de 3000L — método Morais (1962)/Bartolomeu (1996): ${fmt(septicTankResult.volumeM3 * 1000)} L = ${fmt(septicTankResult.volumeM3)} m³ (${septicTankResult.compartments} compartimentos)`
    );
    if (infiltrationAreaM2 !== null) {
      push(
        "12.2",
        byCode["12.2"],
        "medido",
        `${septic.numberOfPeople} pessoa(s) × ${fmt(INFILTRATION_AREA_PER_PERSON_M2[septic.soilType]!)} m²/pessoa (${SOIL_TYPE_LABELS[septic.soilType]}) — tabela de Morais (1962)/Bartolomeu (1996)`
      );
    } else {
      push(
        "12.2",
        0,
        "medido",
        `Solo indicado (${SOIL_TYPE_LABELS[septic.soilType]}) não tem solução por infiltração simples segundo a tabela de referência — considere um poço absorvente mais profundo, aterro filtrante, ou outra solução com acompanhamento de um especialista`
      );
    }
  }

  push("13.1", byCode["13.1"], "estimativa", totalRooms > 0 ? "1 quadro principal (rácio de pré-dimensionamento — 1 por edifício)" : "Sem compartimentos — eléctricas a zero");
  push(
    "13.2",
    byCode["13.2"],
    "estimativa",
    `${totalRooms} compartimento(s) / área ${fmt(totalBuiltArea)} m² → máx(compartimentos, área÷12) pontos de iluminação (estimativa)`,
  );
  push(
    "13.3",
    byCode["13.3"],
    "estimativa",
    `${totalRooms} compartimento(s) / área ${fmt(totalBuiltArea)} m² → máx(2×compartimentos, área÷8) tomadas (estimativa)`,
  );
  push("13.4", byCode["13.4"], "estimativa", totalRooms > 0 ? "1 vg rede de terra (rácio de pré-dimensionamento)" : "Sem compartimentos — eléctricas a zero");

  push("15.1", byCode["15.1"], "medido", `${interiorDoors} porta(s) interior(es) confirmada(s)`);
  push("15.2", byCode["15.2"], "medido", `${exteriorDoors} porta(s) exterior(es) confirmada(s)`);
  push("15.3", byCode["15.3"], "medido", `Soma largura × altura × quantidade das janelas confirmadas: ${fmt(windowArea)} m²`);
  push("15.4", byCode["15.4"], "medido", `Soma das larguras de portas e janelas confirmadas: ${fmt(openingLintelLength)} ml`);

  const chapterCodes = selectedChapterCodes(input.scopes);
  if (input.septicTank) chapterCodes.add("12");
  const isSelected = (code: string) => chapterCodes.has(code.split(".")[0]);

  return {
    byCode: Object.fromEntries(Object.entries(byCode).filter(([code]) => isSelected(code))),
    report: report.filter((entry) => isSelected(entry.code)),
    summary: {
      totalBuiltArea,
      groundFloorArea,
      roofArea,
      totalExteriorWallArea,
      totalInteriorWallArea,
      grossExteriorWallArea,
      grossInteriorWallArea,
      exteriorOpeningArea,
      interiorOpeningArea,
      wetRoomsCount,
      concreteVolume,
      steelWeight,
      footingConcreteVolume,
      totalFixtures,
    },
  };
}

function roofType_isFlat(roofType: RoofType) {
  return roofType === "laje_plana";
}

// Encontra, dentro da secção-padrão do documento, os itens pelo código (1.1, 2.1, ...) e
// substitui as suas medições por uma única linha calculada — mantendo tudo revisável depois
// (o utilizador pode abrir "medições" no item e ajustar/adicionar linhas normalmente).
export async function applyQuickEstimate(documentId: string, sectionId: string, input: QuickEstimateInput) {
  await ensureSelectedChapters(sectionId, input);
  const { byCode, summary, report } = computeQuantities(input);
  const reportByCode = new Map(report.map((r) => [r.code, r]));

  const items = await db.select().from(lineItems).where(and(eq(lineItems.sectionId, sectionId), inArray(lineItems.code, Object.keys(byCode))));

  let itemsUpdated = 0;
  for (const item of items) {
    const quantity = byCode[item.code ?? ""];
    if (quantity === undefined) continue;

    // A descrição da medição passa a ser a fórmula real usada (ex: "26 sapata(s) × 1,38 m² ×
    // 0,42 m (profundidade média) — dados extraídos da planta estrutural"), em vez de um rótulo
    // genérico — para se poder auditar de onde veio o número directamente na régua de medições,
    // sem ter de abrir o Relatório de Cálculos à parte.
    const formula = reportByCode.get(item.code ?? "")?.formula ?? "Estimativa automática (Assistente de Medições)";

    await db.delete(measurementLines).where(eq(measurementLines.lineItemId, item.id));
    await db.insert(measurementLines).values({
      lineItemId: item.id,
      description: formula.slice(0, 300),
      count: quantity.toFixed(2),
      sortOrder: 0,
    });
    await db.update(lineItems).set({ quantity: quantity.toFixed(2), origin: "estimativa" }).where(eq(lineItems.id, item.id));
    itemsUpdated++;
  }

  await db
    .update(budgetDocuments)
    .set({ lastEstimateReport: { generatedAt: new Date().toISOString(), entries: report } })
    .where(eq(budgetDocuments.id, documentId));

  return { itemsUpdated, summary, report };
}

async function ensureSelectedChapters(sectionId: string, input: QuickEstimateInput) {
  const selectedCodes = selectedChapterCodes(input.scopes);
  if (input.septicTank) selectedCodes.add("12");
  const existing = await db.select().from(lineItems).where(eq(lineItems.sectionId, sectionId));
  const chaptersByCode = new Map(existing.filter((item) => item.kind === "capitulo" && item.code).map((item) => [item.code!, item]));
  const itemCodes = new Set(existing.filter((item) => item.kind === "item" && item.code).map((item) => item.code!));
  let chapterSortOrder = chaptersByCode.size;

  for (const templateChapter of STANDARD_CHAPTERS.filter((chapter) => selectedCodes.has(chapter.code))) {
    let chapter = chaptersByCode.get(templateChapter.code);
    if (!chapter) {
      [chapter] = await db.insert(lineItems).values({
        sectionId, parentId: null, kind: "capitulo", code: templateChapter.code,
        description: templateChapter.name, origin: "manual", sortOrder: chapterSortOrder++,
      }).returning();
      chaptersByCode.set(templateChapter.code, chapter);
    }

    let itemSortOrder = existing.filter((item) => item.parentId === chapter.id).length;
    for (const templateItem of templateChapter.items) {
      if (itemCodes.has(templateItem.code)) continue;
      await db.insert(lineItems).values({
        sectionId, parentId: chapter.id, kind: "item", code: templateItem.code,
        description: templateItem.description, unit: templateItem.unit, quantity: "0",
        unitPrice: null, compositionId: null, origin: "manual", sortOrder: itemSortOrder++,
      });
      itemCodes.add(templateItem.code);
    }
  }
}

export async function getStandardSectionId(documentId: string): Promise<string | null> {
  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  if (sections.length === 0) return null;

  const generatedSection = sections.find((section) => section.templateKey?.startsWith("sigo_"));
  if (generatedSection) return generatedSection.id;

  // Um documento importado pode ter códigos como 1.1/2.1/3.1, mas com trabalhos completamente
  // diferentes do modelo SIGO. Verifica também a descrição de itens sentinela para nunca aplicar
  // quantidades automáticas no trabalho errado só porque o código coincide.
  const sentinelCodes = ["1.1", "2.1", "3.2", "4.1", "11.1"];
  const expectedByCode = new Map(
    STANDARD_CHAPTERS.flatMap((chapter) => chapter.items).map((item) => [item.code, item.description]),
  );

  for (const section of sections) {
    const items = await db
      .select({ code: lineItems.code, description: lineItems.description })
      .from(lineItems)
      .where(and(eq(lineItems.sectionId, section.id), inArray(lineItems.code, sentinelCodes)));
    const exactMatches = items.filter(
      (item) => item.code && expectedByCode.get(item.code) === item.description,
    ).length;
    if (exactMatches >= 4) return section.id;
  }
  return null;
}
