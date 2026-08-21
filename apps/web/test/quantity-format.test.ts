import { describe, expect, it } from "vitest";
import { formatQuantityDisplay } from "@sigo/shared";

describe("formatQuantityDisplay", () => {
  it("mostra 2 casas decimais sem alterar null", () => {
    expect(formatQuantityDisplay(null)).toBe("—");
    expect(formatQuantityDisplay(12.3456)).toBe("12,35");
    expect(formatQuantityDisplay(1000)).toMatch(/1[\s\u00a0]?000,00/);
  });
});
