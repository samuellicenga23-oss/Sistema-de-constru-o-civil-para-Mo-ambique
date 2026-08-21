import { describe, expect, it } from "vitest";
import {
  median,
  resolveEffectivePriceFromObservations,
  resolvePriceFreshnessBadge,
  priceFreshnessBadgeLabel,
} from "@sigo/shared";

describe("priceObservations policy (prompt 05)", () => {
  it("calcula mediana de N confirmados", () => {
    expect(median([100, 200, 300])).toBe(200);
    expect(median([100, 150, 200, 250])).toBe(175);

    const result = resolveEffectivePriceFromObservations(
      [
        { id: "a", unitCost: 100, observedAt: "2026-01-01", confidence: "confirmed" },
        { id: "b", unitCost: 200, observedAt: "2026-02-01", confidence: "confirmed" },
        { id: "c", unitCost: 300, observedAt: "2026-03-01", confidence: "confirmed" },
        { id: "d", unitCost: 999, observedAt: "2026-04-01", confidence: "estimated" },
      ],
      "median_n",
      3,
    );

    expect(result?.unitCost).toBe(200);
    expect(result?.observationCount).toBe(3);
    expect(result?.sourceObservationIds).toEqual(["c", "b", "a"]);
  });

  it("last_confirmed escolhe o confirmado mais recente", () => {
    const result = resolveEffectivePriceFromObservations(
      [
        { id: "old", unitCost: 50, observedAt: "2025-01-01", confidence: "confirmed" },
        { id: "new", unitCost: 80, observedAt: "2026-06-01", confidence: "confirmed" },
        { id: "est", unitCost: 10, observedAt: "2026-08-01", confidence: "estimated" },
      ],
      "last_confirmed",
    );

    expect(result?.unitCost).toBe(80);
    expect(result?.sourceObservationIds).toEqual(["new"]);
  });

  it("manual devolve null", () => {
    expect(
      resolveEffectivePriceFromObservations(
        [{ unitCost: 10, observedAt: "2026-01-01", confidence: "confirmed" }],
        "manual",
      ),
    ).toBeNull();
  });

  it("badge reflecte idade e confiança", () => {
    expect(resolvePriceFreshnessBadge({ observedAt: "2026-08-01", confidence: "confirmed" }, "2026-08-21")).toBe("confirmado");
    expect(resolvePriceFreshnessBadge({ observedAt: "2026-08-01", confidence: "estimated" }, "2026-08-21")).toBe("estimado");
    expect(resolvePriceFreshnessBadge({ observedAt: "2025-01-01", confidence: "confirmed" }, "2026-08-21")).toBe("desactualizado");
    expect(priceFreshnessBadgeLabel("confirmado")).toBe("Confirmado");
  });
});
