import { describe, expect, it } from "vitest";
import { addWorkingDays, isWorkingDay, workingDaysInclusive } from "@sigo/shared";

describe("calendário MZ — dias úteis", () => {
  const holidays = new Set(["2026-06-25"]);

  it("sábado conta por omissão", () => {
    expect(isWorkingDay("2026-07-25")).toBe(true);
    expect(addWorkingDays("2026-07-24", 1)).toBe("2026-07-25");
  });

  it("sábado off exclui sábado", () => {
    expect(isWorkingDay("2026-07-25", { saturdayWorking: false })).toBe(false);
    expect(addWorkingDays("2026-07-24", 1, { saturdayWorking: false })).toBe("2026-07-27");
  });

  it("feriado desloca datas úteis", () => {
    expect(isWorkingDay("2026-06-25", { holidays })).toBe(false);
    expect(addWorkingDays("2026-06-24", 1, { holidays })).toBe("2026-06-26");
    expect(workingDaysInclusive("2026-06-24", "2026-06-26", { holidays })).toBe(2);
  });
});
