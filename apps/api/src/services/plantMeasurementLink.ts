import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { plants, extractedRooms } from "../db/schema.js";

// Liga a régua de medições às áreas dos compartimentos extraídos da planta, por código de item
// do mapa de quantidades (ex: 5.1 → uma linha por compartimento com a área da planta).

export type PlantRoom = {
  id: string;
  name: string;
  number: string | null;
  areaM2: number;
  floor: string | null;
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

function estimateWallAreaM2(floorAreaM2: number, ceilingHeight = 2.7): number {
  if (floorAreaM2 <= 0) return 0;
  const side = Math.sqrt(floorAreaM2);
  return 4 * side * ceilingHeight;
}

type RoomFilter = "all" | "wet" | "dry" | "ground";

type MeasureStrategy =
  | { kind: "per_room_area"; filter: RoomFilter }
  | { kind: "per_room_wall"; filter: Exclude<RoomFilter, "ground">; ceilingHeight?: number }
  | { kind: "single_total"; filter: RoomFilter }
  | { kind: "count_rooms"; filter: Exclude<RoomFilter, "ground"> };

// Códigos do mapa padrão SIGO (boqTemplate) com regra de preenchimento a partir da planta.
const ITEM_STRATEGIES: Record<string, MeasureStrategy> = {
  "1.1": { kind: "single_total", filter: "ground" },
  "1.3": { kind: "single_total", filter: "ground" },
  "2.4": { kind: "single_total", filter: "ground" },
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

export function buildMeasurementLinesFromPlant(itemCode: string, rooms: PlantRoom[]): PlantFillResult {
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
    const wallArea = estimateWallAreaM2(room.areaM2, ceilingHeight);
    return {
      description: `${roomLabel(room)} (≈ parede, h=${ceilingHeight}m)`,
      count: 1,
      length: wallArea,
      width: 1,
      height: null,
      sortOrder: index,
    };
  });

  return {
    ok: true,
    strategy: strategy.kind === "per_room_area" ? `área por compartimento (${strategy.filter})` : `parede estimada (${strategy.filter})`,
    roomCount: filtered.length,
    lines,
  };
}

export function supportedPlantItemCodes(): string[] {
  return Object.keys(ITEM_STRATEGIES);
}

export async function loadProjectPlantRooms(projectId: string): Promise<PlantRoom[]> {
  const plantRows = await db
    .select()
    .from(plants)
    .where(eq(plants.projectId, projectId))
    .orderBy(desc(plants.uploadedAt));

  for (const plant of plantRows) {
    if (plant.processingStatus !== "concluido") continue;
    const rooms = await db.select().from(extractedRooms).where(eq(extractedRooms.plantId, plant.id));
    if (rooms.length === 0) continue;
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      number: r.number,
      areaM2: Number(r.areaM2),
      floor: r.floor,
    }));
  }
  return [];
}
