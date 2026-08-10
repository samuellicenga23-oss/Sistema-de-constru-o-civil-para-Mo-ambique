import { describe, expect, it } from "vitest";
import {
  buildMeasurementLinesFromPlant,
  deduplicatePlantOpenings,
  deduplicatePlantRooms,
  type PlantOpening,
  type PlantHydroEquipment,
  type PlantHydroPipe,
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

const hydroPipes: PlantHydroPipe[] = [
  { system: "aguas_residuais", material: "PVC", diameterMm: 110, diameterInch: null, page: 88, floor: "Piso Térreo", measuredLengthM: 43.9, confidence: 0.84 },
  { system: "aguas_residuais", material: "PVC", diameterMm: 75, diameterInch: null, page: 89, floor: "Piso Superior", measuredLengthM: 4.04, confidence: 0.78 },
];

const hydroEquipment: PlantHydroEquipment[] = [
  { kind: "deposito", code: null, page: 86, floor: "Piso Térreo", quantity: 1, capacityL: 1500, confidence: 0.95, requiresConfirmation: false },
  { kind: "ponto_abastecimento", code: "B01", page: 86, floor: "Piso Térreo", quantity: 1, capacityL: null, confidence: 0.92, requiresConfirmation: false },
  { kind: "ponto_abastecimento", code: "B02", page: 86, floor: "Piso Térreo", quantity: 1, capacityL: null, confidence: 0.92, requiresConfirmation: false },
  { kind: "caixa_drenagem", code: null, page: 88, floor: "Piso Térreo", quantity: 11, capacityL: null, confidence: 0.72, requiresConfirmation: true },
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
  it("não inventa paredes quadradas quando o perímetro está em falta", () => {
    const result = buildMeasurementLinesFromPlant("4.1", [{ ...rooms[0], perimeterM: null }], openings);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("perímetro confirmado");
  });

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

describe("medições ligadas às redes técnicas", () => {
  it("liga somente sistema e diâmetro exactos", () => {
    const result = buildMeasurementLinesFromPlant("8.1", rooms, openings, hydroPipes, "Tubagem de esgoto uPVC Ø110 mm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ length: 43.9 });
  });

  it("não usa a tubagem Ø75 para preencher um item Ø40", () => {
    const result = buildMeasurementLinesFromPlant("8.2", rooms, openings, hydroPipes, "Tubagem de esgoto uPVC Ø40 mm");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Ø40 mm");
  });

  it("liga o reservatório apenas quando a capacidade confirmada coincide", () => {
    const confirmed = buildMeasurementLinesFromPlant("9.1", rooms, openings, hydroPipes, "Reservatório de água de 1500 L", hydroEquipment);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.lines).toHaveLength(1);
    expect(confirmed.lines[0]).toMatchObject({ count: 1 });

    const otherCapacity = buildMeasurementLinesFromPlant("9.1", rooms, openings, hydroPipes, "Reservatório de água de 500 L", hydroEquipment);
    expect(otherCapacity.ok).toBe(false);
  });

  it("soma pontos codificados e ignora símbolos ainda por confirmar", () => {
    const points = buildMeasurementLinesFromPlant("9.2", rooms, openings, hydroPipes, "Ponto de abastecimento de água", hydroEquipment);
    expect(points.ok).toBe(true);
    if (!points.ok) return;
    expect(points.lines.map((line) => line.count)).toEqual([1, 1]);
    expect(points.lines.map((line) => line.description)).toEqual(expect.arrayContaining([
      expect.stringContaining("B01"),
      expect.stringContaining("B02"),
    ]));
  });
});
