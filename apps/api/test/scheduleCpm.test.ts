import { describe, expect, it } from "vitest";
import { computeCpmNetwork, inLookahead, lookaheadWindow } from "../src/services/scheduleCpm.js";
import { isWorkingDay } from "../src/services/schedulePlanning.js";

describe("CPM e lookahead", () => {
  it("calcula float e caminho crítico numa rede FS simples", () => {
    const cpm = computeCpmNetwork(
      [
        { id: "a", durationDays: 2 },
        { id: "b", durationDays: 3 },
        { id: "c", durationDays: 1 },
      ],
      [
        { predecessorId: "a", successorId: "b", type: "FS", lagDays: 0 },
        { predecessorId: "b", successorId: "c", type: "FS", lagDays: 0 },
      ],
      "2026-08-03",
    );
    expect(cpm.get("a")?.isCritical).toBe(true);
    expect(cpm.get("b")?.isCritical).toBe(true);
    expect(cpm.get("c")?.isCritical).toBe(true);
    expect(cpm.get("a")?.totalFloatDays).toBe(0);
  });

  it("uma tarefa paralela tem folga", () => {
    const cpm = computeCpmNetwork(
      [
        { id: "a", durationDays: 5 },
        { id: "b", durationDays: 2 },
        { id: "c", durationDays: 1 },
      ],
      [
        { predecessorId: "a", successorId: "c", type: "FS", lagDays: 0 },
        { predecessorId: "b", successorId: "c", type: "FS", lagDays: 0 },
      ],
      "2026-08-03",
    );
    expect(cpm.get("a")?.isCritical).toBe(true);
    expect(cpm.get("b")?.isCritical).toBe(false);
    expect(cpm.get("b")!.totalFloatDays).toBeGreaterThan(0);
  });

  it("respeita SS, lag e marco de 0 dias", () => {
    const cpm = computeCpmNetwork(
      [
        { id: "a", durationDays: 3 },
        { id: "m", durationDays: 0 },
      ],
      [{ predecessorId: "a", successorId: "m", type: "SS", lagDays: 1 }],
      "2026-08-03",
    );
    expect(cpm.get("m")?.isMilestone).toBe(true);
    expect(cpm.get("m")?.earlyStart).not.toBe(cpm.get("a")?.earlyStart);
  });

  it("lookahead de 2 semanas inclui só o que sobrepõe o horizonte", () => {
    const window = lookaheadWindow("2026-08-03", 2);
    expect(inLookahead({ startDate: "2026-08-04", endDate: "2026-08-10" }, window)).toBe(true);
    expect(inLookahead({ startDate: "2026-09-01", endDate: "2026-09-10" }, window)).toBe(false);
    expect(inLookahead({ startDate: "2026-08-04", endDate: "2026-08-10", status: "concluido" }, window)).toBe(false);
  });

  it("calendário ignora domingo", () => {
    expect(isWorkingDay("2026-08-09")).toBe(false);
    expect(isWorkingDay("2026-08-08")).toBe(true);
  });
});
