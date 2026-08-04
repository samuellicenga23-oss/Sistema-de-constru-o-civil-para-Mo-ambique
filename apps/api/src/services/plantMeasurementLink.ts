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
  widthM: number | null;
  heightM: number | null;
  quantity: number;
  floor: string | null;
  location: "interior" | "exterior" | "desconhecida";
  needsConfirmation: boolean;
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

function isGroundFloor(floor: string | null): boolean {
  if (!floor?.trim()) return true;
  const n = normalizeText(floor);
  return /^(0|r\/?c|terreo|térreo|piso\s*0|ground|pt|p\.?\s*t\.?)/.test(n) || n.includes("terreo") || n.includes("térreo");
}

function roomLabel(room: PlantRoom): string {
  const parts = [room.floor, room.number, room.name].filter(Boolean);
  return parts.join(" — ") || room.name;
}

function estimateWallAreaM2(floorAreaM2: number, perimeterM: number | null, ceilingHeight = 2.7): number {
  if (floorAreaM2 <= 0) return 0;
  if (perimeterM != null && perimeterM > 0) return perimeterM * ceilingHeight;
  const side = Math.sqrt(floorAreaM2);
  return 4 * side * ceilingHeight;
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

export function buildMeasurementLinesFromPlant(itemCode: string, rooms: PlantRoom[], openings: PlantOpening[] = []): PlantFillResult {
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
      description: `${opening.floor ?? "Piso por confirmar"} — ${opening.kind}`,
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
    return {
      ok: true,
      strategy: `área total (${strategy.filter})`,
      roomCount: filtered.length,
      lines: [
        {
          description: `Soma de ${filtered.length} compartimento(s) — planta`,
          count: total,
          length: null,
          width: null,
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
    const wallArea = estimateWallAreaM2(room.areaM2, room.perimeterM, ceilingHeight);
    return {
      description: `${roomLabel(room)} (≈ parede, h=${ceilingHeight}m)`,
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
    strategy: strategy.kind === "per_room_area" ? `área por compartimento (${strategy.filter})` : `parede estimada (${strategy.filter})`,
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

export async function loadProjectPlantContext(projectId: string): Promise<{ rooms: PlantRoom[]; openings: PlantOpening[] }> {
  const plantRows = await db
    .select()
    .from(plants)
    .where(eq(plants.projectId, projectId))
    .orderBy(desc(plants.uploadedAt));

  let selectedRooms: PlantRoom[] = [];
  let selectedOpenings: PlantOpening[] = [];
  for (const plant of plantRows) {
    if (plant.processingStatus !== "concluido") continue;
    const [rooms, openings] = await Promise.all([
      db.select().from(extractedRooms).where(eq(extractedRooms.plantId, plant.id)),
      db.select().from(extractedOpenings).where(eq(extractedOpenings.plantId, plant.id)),
    ]);
    if (selectedRooms.length === 0 && rooms.length > 0) {
      selectedRooms = rooms.map((r) => ({
        id: r.id,
        name: r.name,
        number: r.number,
        areaM2: Number(r.areaM2),
        perimeterM: r.perimeterM == null ? null : Number(r.perimeterM),
        floor: r.floor,
      }));
    }
    if (selectedOpenings.length === 0 && openings.length > 0) {
      selectedOpenings = openings.map((opening) => ({
        id: opening.id,
        kind: opening.kind as PlantOpening["kind"],
        widthM: opening.widthM == null ? null : Number(opening.widthM),
        heightM: opening.heightM == null ? null : Number(opening.heightM),
        quantity: opening.quantity,
        floor: opening.floor,
        location: opening.location as PlantOpening["location"],
        needsConfirmation: opening.needsConfirmation,
      }));
    }
    if (selectedRooms.length > 0 && selectedOpenings.length > 0) break;
  }
  return { rooms: selectedRooms, openings: selectedOpenings };
}
