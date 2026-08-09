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

  it("mantém a armadura de cada laje no diagnóstico e não usa malhasol da cobertura", () => {
    const result = computeQuantities({
      floors: [
        { label: "Piso Térreo", ceilingHeight: 2.8, perimeter: 40, rooms: [{ name: "Sala", type: "seco", length: 10, width: 10 }] },
      ],
      foundationType: "sapata_isolada",
      footing: { count: 8, avgArea: 1.2, avgDepth: 0.45 },
      concreteClass: "B25",
      roofType: "laje_plana",
      roofArea: 100,
      pavementReinforcement: "bars_6_20",
      groundBeam: { enabled: false },
      floorSlabs: [{
        label: "Cobertura",
        areaM2: 100,
        thicknessM: 0.12,
        bottomRebar: { xDiameterMm: 8, xSpacingCm: 20, yDiameterMm: 10, ySpacingCm: 15 },
      }],
    });

    expect(result.report.find((entry) => entry.code === "3.6")?.formula).toContain("armadura de lajes lida");
    expect(result.report.find((entry) => entry.code === "3.7")?.value).toBe(0);
    expect(result.report.find((entry) => entry.code === "3.7")?.formula).toContain("Ø6/20");
  });

  it("mede malhasol no pavimento térreo com sobreposição, não na cobertura", () => {
    const result = computeQuantities({
      floors: [{ label: "Piso Térreo", ceilingHeight: 2.8, perimeter: 40, rooms: [{ name: "Sala", type: "seco", length: 10, width: 10 }] }],
      foundationType: "sapata_isolada",
      footing: { count: 4, avgArea: 1, avgDepth: 0.4 },
      concreteClass: "B25",
      roofType: "chapa_metalica",
      roofArea: 120,
      pavementReinforcement: "welded_mesh",
      groundBeam: { enabled: false },
    });

    expect(result.report.find((entry) => entry.code === "3.7")?.value).toBeCloseTo(110);
  });
});
