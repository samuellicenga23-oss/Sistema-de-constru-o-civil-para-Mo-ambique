import { describe, expect, it } from "vitest";
import { computeQuantities } from "../src/services/quickEstimate.js";

describe("desconto confirmado de portas e janelas", () => {
  it("desconta apenas vãos confirmados e gera quantidades de caixilharia", () => {
    const result = computeQuantities({
      floors: [{ ceilingHeight: 3, perimeter: 40, rooms: [{ name: "Sala", type: "seco", length: 10, width: 10, perimeterM: 40 }] }],
      foundationType: "sapata_isolada",
      footing: { count: 4, avgArea: 1, avgDepth: 0.5 },
      concreteClass: "B25",
      roofType: "laje_plana",
      floorSlabs: [{ label: "Cobertura", areaM2: 100, thicknessM: 0.15 }],
      openings: [
        { kind: "janela", widthM: 1.5, heightM: 1.2, quantity: 2, location: "exterior", confirmed: true },
        { kind: "porta", widthM: 0.9, heightM: 2.1, quantity: 1, location: "interior", confirmed: true },
        { kind: "janela", widthM: 2, heightM: 1.2, quantity: 1, location: "desconhecida", confirmed: false },
      ],
    });

    expect(result.summary.grossExteriorWallArea).toBe(120);
    expect(result.summary.exteriorOpeningArea).toBeCloseTo(3.6);
    expect(result.summary.totalExteriorWallArea).toBeCloseTo(116.4);
    expect(result.byCode["15.1"]).toBe(1);
    expect(result.byCode["15.3"]).toBeCloseTo(3.6);
    expect(result.byCode["15.4"]).toBeCloseTo(3.9);
  });
});
