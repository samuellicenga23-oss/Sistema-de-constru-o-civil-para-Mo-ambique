import { describe, expect, it } from "vitest";
import { computeQuantities } from "../src/services/quickEstimate.js";

describe("medição de lajes por nível", () => {
  it("soma área × espessura de cada laje sem usar uma média global", () => {
    const result = computeQuantities({
      floors: [
        { label: "Piso Térreo", ceilingHeight: 2.8, perimeter: 40, rooms: [{ name: "Piso térreo", type: "seco", length: 10, width: 10 }] },
        { label: "1º Piso", ceilingHeight: 2.8, perimeter: 36, rooms: [{ name: "Piso superior", type: "seco", length: 10, width: 8 }] },
      ],
      foundationType: "sapata_isolada",
      footing: { count: 8, avgArea: 1.2, avgDepth: 0.45 },
      concreteClass: "B25",
      roofType: "laje_plana",
      roofArea: 80,
      floorSlabs: [
        { label: "Laje do 1º Piso", areaM2: 100, thicknessM: 0.15 },
        { label: "Laje de cobertura", areaM2: 80, thicknessM: 0.12 },
      ],
    });

    const slab = result.report.find((entry) => entry.code === "3.5");
    expect(slab?.value).toBeCloseTo(24.6);
    expect(slab?.formula).toContain("Laje do 1º Piso");
    expect(slab?.formula).toContain("Laje de cobertura");
  });
});
