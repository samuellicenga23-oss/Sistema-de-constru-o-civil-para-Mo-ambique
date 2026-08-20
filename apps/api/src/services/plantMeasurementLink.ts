import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { plants, extractedOpenings, extractedRooms } from "../db/schema.js";

// Liga a régua de medições às áreas dos compartimentos extraídos da planta, por código de item
// do mapa de quantidades (ex: 5.1 → uma linha por compartimento com a área da planta).

export type PlantRoom = {
  id: string;
  name: string;
  number: string | null;
  areaM2: number;
  perimeterM: number | null;
  floor: string | null;
};

export type PlantOpening = {
  id: string;
  kind: "porta" | "janela";
  code?: string | null;
  designation?: string | null;
  widthM: number | null;
  heightM: number | null;
  quantity: number;
  floor: string | null;
  location: "interior" | "exterior" | "desconhecida";
  needsConfirmation: boolean;
};

export type PlantHydroPipe = {
  system: string;
  material: string | null;
  diameterMm: number | null;
  diameterInch: string | null;
  page: number;
  floor: string | null;
  measuredLengthM: number;
  confidence: number;
};

export type PlantHydroEquipment = {
  kind: string;
  code: string | null;
  page: number;
  floor: string | null;
  quantity: number;
  capacityL: number | null;
  confidence: number;
  requiresConfirmation: boolean;
};

export function classifyRoomType(name: string): "seco" | "humido" {
  const n = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return /\bwc\b|casa de banho|banho|cozinha|lavandaria|duche|copa|sanit[aá]rio/.test(n) ? "humido" : "seco";
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * PDFs completos repetem frequentemente a mesma planta em folhas de arquitectura,
 * pormenores e mapas. A leitura conserva a primeira ocorrência exacta e evita que
 * uma repetição de OCR multiplique áreas, compartimentos e vãos na medição.
 * Compartimentos genuinamente repetidos continuam separados quando têm número,
 * área ou piso diferentes.
 */
export function deduplicatePlantRooms(rooms: PlantRoom[]): PlantRoom[] {
  const seen = new Set<string>();
  return rooms.filter((room) => {
    const key = [
      normalizeText(room.floor ?? "piso-nao-identificado"),
      normalizeText(room.name),
      normalizeText(room.number ?? ""),
      room.areaM2.toFixed(2),
      room.perimeterM == null ? "" : room.perimeterM.toFixed(2),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deduplicatePlantOpenings(openings: PlantOpening[]): PlantOpening[] {
  const seen = new Set<string>();
  return openings.filter((opening) => {
    // O código P/J é a identidade fiável entre folhas repetidas. Sem código, duas janelas
    // iguais podem ser vãos físicos distintos; preservá-las é mais seguro do que perder área.
    const key = opening.code?.trim()
      ? [opening.kind, normalizeText(opening.floor ?? "piso-nao-identificado"), normalizeText(opening.code)].join("|")
      : `uncoded:${opening.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isGroundFloor(floor: string | null): boolean {
  if (!floor?.trim()) return true;
  const n = normalizeText(floor);
  return /^(0|r\/?c|terreo|térreo|piso\s*0|ground|pt|p\.?\s*t\.?)/.test(n) || n.includes("terreo") || n.includes("térreo");
}

function roomLabel(room: PlantRoom): string {
  const parts = [room.floor, room.number, room.name].filter(Boolean);
  return parts.join(" — ") || room.name;
}

function confirmedWallAreaM2(perimeterM: number | null, ceilingHeight = 2.7): number | null {
  if (perimeterM == null || perimeterM <= 0) return null;
  return perimeterM * ceilingHeight;
}

type RoomFilter = "all" | "wet" | "dry" | "ground";

type MeasureStrategy =
  | { kind: "per_room_area"; filter: RoomFilter }
  | { kind: "per_room_wall"; filter: Exclude<RoomFilter, "ground">; ceilingHeight?: number }
  | { kind: "single_total"; filter: RoomFilter }
  /** Área total × espessura → volume (ex. enrocamento m³). */
  | { kind: "single_volume"; filter: RoomFilter; thicknessM: number }
  | { kind: "count_rooms"; filter: Exclude<RoomFilter, "ground"> };

// Espessura típica do leito de enrocamento sob pavimento/fundações (alinha ao Assistente).
const DEFAULT_ENROCKMENT_THICKNESS_M = 0.15;

// Códigos do mapa padrão SIGO (boqTemplate) com regra de preenchimento a partir da planta.
const ITEM_STRATEGIES: Record<string, MeasureStrategy> = {
  "1.1": { kind: "single_total", filter: "ground" },
  "1.3": { kind: "single_total", filter: "ground" },
  "2.4": { kind: "single_volume", filter: "ground", thicknessM: DEFAULT_ENROCKMENT_THICKNESS_M },
  "2.5": { kind: "single_total", filter: "ground" },
  "4.1": { kind: "per_room_wall", filter: "all" },
  "4.2": { kind: "per_room_wall", filter: "all" },
  "5.1": { kind: "per_room_area", filter: "all" },
  "5.2": { kind: "per_room_wall", filter: "all" },
  "5.3": { kind: "per_room_wall", filter: "all" },
  "6.1": { kind: "per_room_area", filter: "wet" },
  "6.2": { kind: "per_room_wall", filter: "wet" },
  "7.1": { kind: "per_room_wall", filter: "all" },
  "7.2": { kind: "per_room_wall", filter: "dry" },
  "7.3": { kind: "per_room_area", filter: "all" },
};

function filterRooms(rooms: PlantRoom[], filter: RoomFilter): PlantRoom[] {
  if (filter === "all") return rooms;
  if (filter === "ground") return rooms.filter((r) => isGroundFloor(r.floor));
  if (filter === "wet") return rooms.filter((r) => classifyRoomType(r.name) === "humido");
  return rooms.filter((r) => classifyRoomType(r.name) === "seco");
}

export type PlantMeasurementLineDraft = {
  description: string;
  count: number;
  length: number | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
};

export type PlantFillResult =
  | { ok: true; lines: PlantMeasurementLineDraft[]; strategy: string; roomCount: number }
  | { ok: false; reason: string };

function parseHydroTarget(description: string): {
  system: string | null;
  diameterMm: number | null;
  diameterInch: string | null;
} | null {
  const normalized = normalizeText(description);
  if (!/tubagem|tubo|rede de agua|canalizacao/.test(normalized)) return null;
  const system = /pluvial/.test(normalized)
    ? "aguas_pluviais"
    : /esgoto|residu/.test(normalized)
      ? "aguas_residuais"
      : /agua quente/.test(normalized)
        ? "agua_quente"
        : /agua fria|abastecimento/.test(normalized)
          ? "agua_fria"
          : null;
  const fraction = description.match(/(?:Ø|DN)?\s*((?:\d+\s+)?\d+\s*\/\s*\d+|[½¾¼⅜⅝])\s*["”]/i);
  const metric = description.match(/(?:Ø|DN)\s*(\d+(?:[.,]\d+)?)\s*mm\b/i)
    ?? description.match(/\b(\d{2,3})\s*mm\b/i);
  return {
    system,
    diameterMm: metric ? Number(metric[1].replace(",", ".")) : null,
    diameterInch: fraction ? fraction[1].replace(/\s+/g, "") : null,
  };
}

function buildHydroMeasurementLines(description: string, pipes: PlantHydroPipe[]): PlantFillResult | null {
  const target = parseHydroTarget(description);
  if (!target) return null;
  if (!target.system || (target.diameterMm == null && target.diameterInch == null)) {
    return { ok: false, reason: "Indique o sistema e o diâmetro no item para ligar a tubagem medida na planta." };
  }
  const selected = pipes.filter((pipe) =>
    pipe.system === target.system
    && (target.diameterMm == null || Math.abs((pipe.diameterMm ?? -1) - target.diameterMm) < 0.01)
    && (target.diameterInch == null || pipe.diameterInch === target.diameterInch)
  );
  if (!selected.length) {
    const diameter = target.diameterMm != null ? `Ø${target.diameterMm} mm` : `Ø${target.diameterInch}″`;
    return { ok: false, reason: `Não há traçado ${diameter} confirmado para este sistema na planta.` };
  }
  return {
    ok: true,
    strategy: "comprimento vetorial por sistema, diâmetro e piso",
    roomCount: 0,
    lines: selected.map((pipe, index) => ({
      description: [pipe.floor ?? "Piso por confirmar", pipe.material, pipe.diameterMm != null ? `Ø${pipe.diameterMm} mm` : `Ø${pipe.diameterInch}″`, `pág. ${pipe.page}`].filter(Boolean).join(" — "),
      count: 1,
      length: pipe.measuredLengthM,
      width: null,
      height: null,
      sortOrder: index,
    })),
  };
}

function buildHydroEquipmentLines(description: string, equipment: PlantHydroEquipment[]): PlantFillResult | null {
  const normalized = normalizeText(description);
  let kind: string | null = null;
  if (/ponto.*(?:agua|abastecimento)/.test(normalized)) kind = "ponto_abastecimento";
  else if (/reservatorio|deposito.*agua/.test(normalized)) kind = "deposito";
  else if (/contador.*agua/.test(normalized)) kind = "contador";
  else if (/filtro.*piscina/.test(normalized)) kind = "filtro_piscina";
  else if (/bomba.*piscina/.test(normalized)) kind = "bomba_piscina";
  else if (/skimmer/.test(normalized)) kind = "skimmer";
  else if (/regulador.*nivel/.test(normalized)) kind = "regulador_nivel";
  else if (/boca.*impulsao/.test(normalized)) kind = "boca_impulsao";
  else if (/aspirador.*piscina/.test(normalized)) kind = "aspirador_piscina";
  else if (/quadro.*piscina/.test(normalized)) kind = "quadro_piscina";
  if (!kind) return null;

  const capacityMatch = description.match(/\b(\d{3,5})\s*L\b/i);
  const capacityL = capacityMatch ? Number(capacityMatch[1]) : null;
  const selected = equipment.filter((item) =>
    item.kind === kind
    && !item.requiresConfirmation
    && (capacityL == null || item.capacityL === capacityL)
  );
  if (!selected.length) {
    return { ok: false, reason: capacityL ? `Não há ${kind.replaceAll("_", " ")} de ${capacityL} L confirmado na planta.` : `Não há ${kind.replaceAll("_", " ")} confirmado na planta.` };
  }
  return {
    ok: true,
    strategy: "equipamento codificado ou identificado na planta",
    roomCount: 0,
    lines: selected.map((item, index) => ({
      description: [item.floor ?? "Piso por confirmar", item.code, `pág. ${item.page}`].filter(Boolean).join(" — "),
      count: item.quantity,
      length: null,
      width: null,
      height: null,
      sortOrder: index,
    })),
  };
}

export function buildMeasurementLinesFromPlant(
  itemCode: string,
  rooms: PlantRoom[],
  openings: PlantOpening[] = [],
  hydroPipes: PlantHydroPipe[] = [],
  itemDescription = "",
  hydroEquipment: PlantHydroEquipment[] = [],
): PlantFillResult {
  const hydroEquipmentResult = buildHydroEquipmentLines(itemDescription, hydroEquipment);
  if (hydroEquipmentResult) return hydroEquipmentResult;
  const hydroResult = buildHydroMeasurementLines(itemDescription, hydroPipes);
  if (hydroResult) return hydroResult;
  const confirmedOpenings = openings.filter(
    (opening) => !opening.needsConfirmation && opening.widthM != null && opening.heightM != null && opening.location !== "desconhecida",
  );
  const openingLines = (() => {
    const selected =
      itemCode === "15.1"
        ? confirmedOpenings.filter((opening) => opening.kind === "porta" && opening.location === "interior")
        : itemCode === "15.2"
          ? confirmedOpenings.filter((opening) => opening.kind === "porta" && opening.location === "exterior")
          : itemCode === "15.3"
            ? confirmedOpenings.filter((opening) => opening.kind === "janela")
            : itemCode === "15.4"
              ? confirmedOpenings
              : null;
    if (selected === null) return null;
    return selected.map((opening, index) => ({
      description: [opening.floor ?? "Piso por confirmar", opening.designation ?? opening.code ?? opening.kind].join(" — "),
      count: opening.quantity,
      length: itemCode === "15.3" ? opening.widthM : itemCode === "15.4" ? opening.widthM : null,
      width: itemCode === "15.3" ? opening.heightM : itemCode === "15.4" ? 1 : null,
      height: null,
      sortOrder: index,
    }));
  })();
  if (openingLines !== null) {
    if (openingLines.length === 0) {
      return { ok: false, reason: "Não há vãos confirmados desta categoria. Confirme portas e janelas na revisão da planta." };
    }
    return { ok: true, lines: openingLines, strategy: "vãos confirmados da planta", roomCount: rooms.length };
  }

  const strategy = ITEM_STRATEGIES[itemCode];
  if (!strategy) {
    return {
      ok: false,
      reason: `O código "${itemCode}" ainda não tem regra de ligação à planta. Use a régua manualmente ou o Assistente de Medições.`,
    };
  }
  if (rooms.length === 0) {
    return { ok: false, reason: "Não há compartimentos extraídos da planta neste projecto." };
  }

  const filtered = filterRooms(rooms, strategy.filter);
  if (filtered.length === 0) {
    const filterLabel =
      strategy.filter === "wet" ? "húmido" : strategy.filter === "dry" ? "seco" : strategy.filter === "ground" ? "piso térreo" : "compartimento";
    return { ok: false, reason: `Nenhum compartimento "${filterLabel}" encontrado na planta para este item.` };
  }

  if (strategy.kind === "count_rooms") {
    return {
      ok: true,
      strategy: `contagem (${strategy.filter})`,
      roomCount: filtered.length,
      lines: [
        {
          description: `${filtered.length} compartimento(s) — planta`,
          count: filtered.length,
          length: null,
          width: null,
          height: null,
          sortOrder: 0,
        },
      ],
    };
  }

  if (strategy.kind === "single_total") {
    const total = filtered.reduce((s, r) => s + r.areaM2, 0);
    // Representar área total como length × width (= total × 1) para a fórmula "area"
    // do preview/apply — guardar só em `count` fazia o motor exigir C/L e rebentar com 500.
    return {
      ok: true,
      strategy: `área total (${strategy.filter})`,
      roomCount: filtered.length,
      lines: [
        {
          description: `Soma de ${filtered.length} compartimento(s) — planta`,
          count: 1,
          length: total,
          width: 1,
          height: null,
          sortOrder: 0,
        },
      ],
    };
  }

  if (strategy.kind === "single_volume") {
    const totalArea = filtered.reduce((s, r) => s + r.areaM2, 0);
    const thicknessM = strategy.thicknessM;
    return {
      ok: true,
      strategy: `volume = área × ${thicknessM} m (${strategy.filter})`,
      roomCount: filtered.length,
      lines: [
        {
          description: `Soma de ${filtered.length} compartimento(s) — planta × ${thicknessM} m (espessura do leito)`,
          count: 1,
          length: totalArea,
          width: 1,
          height: thicknessM,
          sortOrder: 0,
        },
      ],
    };
  }

  if (strategy.kind === "per_room_wall") {
    const roomsWithoutPerimeter = filtered.filter((room) => room.perimeterM == null || room.perimeterM <= 0);
    if (roomsWithoutPerimeter.length > 0) {
      return {
        ok: false,
        reason: `${roomsWithoutPerimeter.length} compartimento(s) não têm perímetro confirmado. Preencha os perímetros antes de calcular paredes, rebocos, revestimentos ou pintura.`,
      };
    }
  }

  const ceilingHeight = strategy.kind === "per_room_wall" ? (strategy.ceilingHeight ?? 2.7) : 2.7;
  const lines: PlantMeasurementLineDraft[] = filtered.map((room, index) => {
    if (strategy.kind === "per_room_area") {
      return {
        description: roomLabel(room),
        count: 1,
        length: room.areaM2,
        width: 1,
        height: null,
        sortOrder: index,
      };
    }
    const wallArea = confirmedWallAreaM2(room.perimeterM, ceilingHeight)!;
    return {
      description: `${roomLabel(room)} (perímetro confirmado × h=${ceilingHeight}m)`,
      count: 1,
      length: wallArea,
      width: 1,
      height: null,
      sortOrder: index,
    };
  });

  // Só os dois itens de paredes com significado inequívoco recebem desconto
  // automático. Vãos incertos ou sem classificação interior/exterior ficam fora.
  const openingLocation = itemCode === "4.1" ? "exterior" : itemCode === "4.2" ? "interior" : null;
  if (strategy.kind === "per_room_wall" && openingLocation) {
    const deduction = confirmedOpenings
      .filter((opening) => opening.location === openingLocation)
      .reduce((sum, opening) => sum + opening.widthM! * opening.heightM! * opening.quantity, 0);
    const gross = lines.reduce((sum, line) => sum + (line.length ?? 0), 0);
    if (deduction > 0 && gross > 0) {
      for (const line of lines) {
        const share = (line.length ?? 0) / gross;
        line.length = Math.max(0, (line.length ?? 0) - deduction * share);
        line.description = `${line.description} (líquida de vãos confirmados)`;
      }
    }
  }

  return {
    ok: true,
    strategy: strategy.kind === "per_room_area" ? `área por compartimento (${strategy.filter})` : `parede por perímetro confirmado (${strategy.filter})`,
    roomCount: filtered.length,
    lines,
  };
}

export function supportedPlantItemCodes(): string[] {
  return [...Object.keys(ITEM_STRATEGIES), "15.1", "15.2", "15.3", "15.4"];
}

export async function loadProjectPlantRooms(projectId: string): Promise<PlantRoom[]> {
  return (await loadProjectPlantContext(projectId)).rooms;
}

export async function loadProjectPlantContext(projectId: string): Promise<{
  rooms: PlantRoom[];
  openings: PlantOpening[];
  hydroPipes: PlantHydroPipe[];
  hydroEquipment: PlantHydroEquipment[];
  identityConflict: boolean;
}> {
  const plantRows = await db
    .select()
    .from(plants)
    .where(eq(plants.projectId, projectId))
    .orderBy(desc(plants.uploadedAt));

  // Um conflito de identidade por confirmar congela a sincronização automática de todo o
  // projecto. Continuar para uma planta mais antiga esconderia precisamente o problema que o
  // utilizador precisa de resolver e poderia manter quantidades obsoletas como se fossem actuais.
  const identityConflict = plantRows.some((plant) =>
    plant.processingStatus === "concluido"
    && plant.documentAnalysis?.requiresIdentityConfirmation
    && !plant.documentAnalysis.identityConfirmed
  );
  if (identityConflict) {
    return { rooms: [], openings: [], hydroPipes: [], hydroEquipment: [], identityConflict: true };
  }

  const selectedRooms: PlantRoom[] = [];
  const selectedOpenings: PlantOpening[] = [];
  const selectedHydroPipes: PlantHydroPipe[] = [];
  const selectedHydroEquipment: PlantHydroEquipment[] = [];
  for (const plant of plantRows) {
    if (plant.processingStatus !== "concluido") continue;
    if (plant.documentAnalysis?.requiresIdentityConfirmation && !plant.documentAnalysis.identityConfirmed) continue;
    selectedHydroPipes.push(...(plant.documentAnalysis?.hydrosanitarySummary?.pipes ?? [])
      .filter((pipe) => pipe.measuredLengthM != null)
      .map((pipe) => ({
        system: pipe.system,
        material: pipe.material,
        diameterMm: pipe.diameterMm,
        diameterInch: pipe.diameterInch,
        page: pipe.page,
        floor: pipe.floor ?? null,
        measuredLengthM: Number(pipe.measuredLengthM),
        confidence: pipe.confidence,
      })));
    selectedHydroEquipment.push(...(plant.documentAnalysis?.hydrosanitarySummary?.equipment ?? [])
      .filter((item) => item.quantity != null)
      .map((item) => ({
        kind: item.kind,
        code: item.code ?? null,
        page: item.page,
        floor: item.floor ?? null,
        quantity: Number(item.quantity),
        capacityL: item.capacityL,
        confidence: item.confidence,
        requiresConfirmation: item.requiresConfirmation ?? true,
      })));
    const [rooms, openings] = await Promise.all([
      db.select().from(extractedRooms).where(eq(extractedRooms.plantId, plant.id)),
      db.select().from(extractedOpenings).where(eq(extractedOpenings.plantId, plant.id)),
    ]);
    if (rooms.length > 0) {
      selectedRooms.push(...rooms.map((r) => ({
        id: r.id,
        name: r.name,
        number: r.number,
        areaM2: Number(r.areaM2),
        perimeterM: r.perimeterM == null ? null : Number(r.perimeterM),
        floor: r.floor,
      })));
    }
    if (openings.length > 0) {
      selectedOpenings.push(...openings.map((opening) => ({
        id: opening.id,
        kind: opening.kind as PlantOpening["kind"],
        code: opening.code,
        designation: opening.designation,
        widthM: opening.widthM == null ? null : Number(opening.widthM),
        heightM: opening.heightM == null ? null : Number(opening.heightM),
        quantity: opening.quantity,
        floor: opening.floor,
        location: opening.location as PlantOpening["location"],
        needsConfirmation: opening.needsConfirmation,
      })));
    }
  }
  return {
    rooms: deduplicatePlantRooms(selectedRooms),
    openings: deduplicatePlantOpenings(selectedOpenings),
    hydroPipes: selectedHydroPipes.filter((pipe, index, all) => all.findIndex((candidate) =>
      candidate.system === pipe.system
      && candidate.floor === pipe.floor
      && candidate.page === pipe.page
      && candidate.diameterMm === pipe.diameterMm
      && candidate.diameterInch === pipe.diameterInch
      && candidate.measuredLengthM === pipe.measuredLengthM
    ) === index),
    hydroEquipment: selectedHydroEquipment.filter((item, index, all) => all.findIndex((candidate) =>
      candidate.kind === item.kind
      && candidate.code === item.code
      && candidate.floor === item.floor
      && candidate.page === item.page
      && candidate.quantity === item.quantity
    ) === index),
    identityConflict: false,
  };
}
