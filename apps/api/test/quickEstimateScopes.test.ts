import { describe, expect, it } from "vitest";
import { selectAdaptiveBoqChapters } from "../src/services/boqTemplate.js";
import { computeQuantities } from "../src/services/quickEstimate.js";

describe("medições adaptativas", () => {
  it("calcula apenas os capítulos seleccionados", () => {
    const result = computeQuantities({
      scopes: ["estrutura"],
      foundationType: "sapata_isolada",
      footing: { count: 8, avgArea: 1.2, avgDepth: 0.35 },
      steelWeightKg: 1250,
      beamConcreteVolumeM3: 12,
      floorSlabs: [{ label: "Laje do piso 1", areaM2: 95, thicknessM: 0.15 }],
    });

    expect(Object.keys(result.byCode)).toEqual(expect.arrayContaining(["3.2", "3.4", "3.5", "3.6"]));
    expect(Object.keys(result.byCode).every((code) => code.startsWith("3."))).toBe(true);
    expect(result.byCode["3.6"]).toBe(1250);
    expect(result.byCode["4.1"]).toBeUndefined();
  });

  it("começa sem capítulos quando não há planta nem âmbito escolhido", () => {
    const selection = selectAdaptiveBoqChapters(null);
    expect(selection.mode).toBe("adaptativo");
    expect(selection.chapters).toEqual([]);
  });
});
