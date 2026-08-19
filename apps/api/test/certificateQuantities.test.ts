import { describe, expect, it } from "vitest";
import { certificateLineQuantities } from "../src/services/certificateQuantities.js";

describe("quantidades do Auto", () => {
  it("rascunho mede mas não certifica", () => {
    const qty = certificateLineQuantities({ status: "rascunho", periodQty: 10, previousQty: 0, budgetedQty: 20 });
    expect(qty.measuredQty).toBe(10);
    expect(qty.proposedQty).toBeNull();
    expect(qty.certifiedQty).toBeNull();
    expect(qty.variationQty).toBe(0);
  });

  it("aprovado certifica só a parte contratual e isola overrun", () => {
    const qty = certificateLineQuantities({ status: "aprovado", periodQty: 6, previousQty: 8, budgetedQty: 10 });
    expect(qty.measuredQty).toBe(6);
    expect(qty.certifiedQty).toBe(2);
    expect(qty.variationQty).toBe(4);
    expect(qty.proposedQty).toBe(6);
  });
});
