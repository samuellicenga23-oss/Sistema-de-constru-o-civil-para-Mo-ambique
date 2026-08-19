import { describe, expect, it } from "vitest";
import {
  columnConcreteVolumeM3,
  columnSteelWeightKg,
  finalizeColumnGroup,
  resolveColumnHeightM,
  syncColumnAggregatesFromGroups,
  type StructuralColumnGroup,
  type StructuralFloor,
} from "@sigo/shared";

const floors: StructuralFloor[] = [
  { label: "Piso Térreo", sortOrder: 0, floorToFloorHeightM: 3, source: "manual" },
  { label: "1º Piso", sortOrder: 1, elevationM: 3, source: "plant" },
];

function group(partial: Partial<StructuralColumnGroup> & Pick<StructuralColumnGroup, "code" | "quantity">): StructuralColumnGroup {
  return {
    shape: "rectangular",
    steelSource: "calculated",
    concreteVolumeM3: 0,
    steelWeightKg: 0,
    needsConfirmation: true,
    confidence: 0.5,
    ...partial,
  };
}

describe("quadro de pilares", () => {
  it("usa altura explícita antes do pé-direito", () => {
    expect(resolveColumnHeightM(group({ code: "P1", quantity: 1, explicitHeightM: 3.3, fromFloor: "Piso Térreo" }), floors)).toEqual({
      heightM: 3.3,
      basis: "explicit",
    });
  });

  it("usa diferença de cotas quando não há altura explícita", () => {
    const result = resolveColumnHeightM(group({
      code: "P1",
      quantity: 1,
      fromFloor: "Piso Térreo",
      toFloor: "1º Piso",
    }), [
      { label: "Piso Térreo", sortOrder: 0, elevationM: 0, source: "manual" },
      { label: "1º Piso", sortOrder: 1, elevationM: 3.2, source: "plant" },
    ]);
    expect(result.basis).toBe("elevations");
    expect(result.heightM).toBe(3.2);
  });

  it("não inventa altura", () => {
    expect(resolveColumnHeightM(group({ code: "P1", quantity: 4 }), []).basis).toBe("missing");
    expect(columnConcreteVolumeM3(group({ code: "P1", quantity: 4, widthCm: 30, depthCm: 20 }), null)).toBe(0);
  });

  it("calcula betão rectangular e circular", () => {
    expect(columnConcreteVolumeM3(group({ code: "P1", quantity: 2, widthCm: 30, depthCm: 20 }), 3.3)).toBe(0.4);
    expect(columnConcreteVolumeM3(group({ code: "P2", quantity: 1, shape: "circular", diameterCm: 40 }), 3)).toBe(0.38);
  });

  it("calcula aço longitudinal sem substituir mapa", () => {
    const calculated = columnSteelWeightKg(group({
      code: "P1=P2",
      quantity: 2,
      widthCm: 30,
      depthCm: 30,
      longitudinalBarCount: 4,
      longitudinalDiameterMm: 12,
    }), 3.3);
    expect(calculated).toBeGreaterThan(20);
    const mapped = finalizeColumnGroup(group({
      code: "P1",
      quantity: 1,
      widthCm: 30,
      depthCm: 30,
      explicitHeightM: 3.3,
      steelWeightKg: 1855,
      steelSource: "map",
    }), floors);
    expect(mapped.steelWeightKg).toBe(1855);
    expect(mapped.steelSource).toBe("map");
  });

  it("agrega quantidade e volume", () => {
    const aggregates = syncColumnAggregatesFromGroups([
      finalizeColumnGroup(group({ code: "P1", quantity: 4, widthCm: 30, depthCm: 20, explicitHeightM: 3 }), floors),
      finalizeColumnGroup(group({ code: "P5", quantity: 1, shape: "circular", diameterCm: 30, explicitHeightM: 3 }), floors),
    ]);
    expect(aggregates.columnsCount).toBe(5);
    expect(aggregates.columnsConcreteVolumeM3).toBeGreaterThan(0.7);
  });
});
