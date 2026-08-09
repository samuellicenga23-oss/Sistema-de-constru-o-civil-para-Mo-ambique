import { describe, expect, it } from "vitest";
import {
  buildMeasurementLinesFromPlant,
  deduplicatePlantOpenings,
  deduplicatePlantRooms,
  type PlantOpening,
  type PlantRoom,
} from "../src/services/plantMeasurementLink.js";

const rooms: PlantRoom[] = [
  { id: "r1", name: "Sala", number: null, areaM2: 100, perimeterM: 46, floor: "Piso Térreo" },
];

const openings: PlantOpening[] = [
  { id: "j1", kind: "janela", code: "J-01", widthM: 1.5, heightM: 1.2, quantity: 2, floor: "Piso Térreo", location: "exterior", needsConfirmation: false },
  { id: "p1", kind: "porta", code: "P-01", widthM: 0.9, heightM: 2.1, quantity: 1, floor: "Piso Térreo", location: "interior", needsConfirmation: false },
  { id: "x1", kind: "janela", widthM: 3, heightM: 2, quantity: 1, floor: null, location: "desconhecida", needsConfirmation: true },
];

describe("deduplicacao da leitura de plantas", () => {
  it("remove repeticoes exactas sem juntar elementos genuinamente diferentes", () => {
    const repeatedRoom = { ...rooms[0], id: "r2" };
    const otherRoom = { ...rooms[0], id: "r3", number: "02", areaM2: 99.5 };
    expect(deduplicatePlantRooms([rooms[0], repeatedRoom, otherRoom]).map((room) => room.id)).toEqual(["r1", "r3"]);

    const repeatedOpening = { ...openings[0], id: "j2" };
    const otherOpening = { ...openings[0], id: "j3", code: "J-02" };
    expect(deduplicatePlantOpenings([openings[0], repeatedOpening, otherOpening]).map((opening) => opening.id)).toEqual(["j1", "j3"]);

    const uncodedA = { ...openings[0], id: "u1", code: null };
    const uncodedB = { ...openings[0], id: "u2", code: null };
    expect(deduplicatePlantOpenings([uncodedA, uncodedB])).toHaveLength(2);
  });
});

describe("medições ligadas aos vãos da planta", () => {
  it("usa o perímetro real e desconta apenas janelas exteriores confirmadas", () => {
    const result = buildMeasurementLinesFromPlant("4.1", rooms, openings);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].length).toBeCloseTo(46 * 2.7 - 1.5 * 1.2 * 2);
  });

  it("gera caixilharia somente a partir dos vãos confirmados", () => {
    const result = buildMeasurementLinesFromPlant("15.3", rooms, openings);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ count: 2, length: 1.5, width: 1.2 });
  });
});
