import { describe, expect, it } from "vitest";
import { boqProvenanceBadge } from "../src/utils/boqProvenance";
import { groupMeasurementsByFloorZone } from "../src/utils/measurementLocationGroups";

describe("proveniência compacta no BOQ", () => {
  it("esconde origem manual e mostra planta/memória", () => {
    expect(boqProvenanceBadge("manual", "manual")).toBeNull();
    expect(boqProvenanceBadge("planta", "plant")?.label).toBe("Planta");
    expect(boqProvenanceBadge("manual", "measurement")?.label).toBe("Medido");
  });
});

describe("agrupamento da memória por piso/zona", () => {
  it("agrupa linhas com o mesmo piso e zona", () => {
    const groups = groupMeasurementsByFloorZone([
      { id: "a", floor: "Piso 1", zone: "Bloco A" },
      { id: "b", floor: "Piso 1", zone: "Bloco A" },
      { id: "c", floor: "Piso 2", zone: null },
      { id: "d", floor: null, zone: null },
    ]);
    expect(groups.map((group) => group.key)).toEqual(["Piso 1 · Bloco A", "Piso 2", ""]);
    expect(groups[0].lines).toHaveLength(2);
  });
});
