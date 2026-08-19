import { describe, expect, it } from "vitest";
import { pickNextAction, rankControlActions } from "../src/services/controlTower.js";

describe("control tower — prioridade de acções", () => {
  it("obra sem dados não inventa bloqueio operacional extra", () => {
    const ranked = rankControlActions([]);
    expect(ranked).toEqual([]);
    const next = pickNextAction([], { code: "diary_continue", level: "info", title: "Registar andamento", detail: "", href: "/" });
    expect(next.code).toBe("diary_continue");
  });

  it("stock negativo precede atraso de cronograma e documentação", () => {
    const ranked = rankControlActions([
      { code: "diary_stale", level: "warning", title: "Diário", detail: "", href: "/d" },
      { code: "schedule_delay", level: "warning", title: "Atraso", detail: "", href: "/s" },
      { code: "stock_negative", level: "critical", title: "Stock", detail: "", href: "/c" },
      { code: "client_invoice_overdue", level: "warning", title: "Vencido", detail: "", href: "/f" },
    ]);
    expect(ranked.map((row) => row.code)).toEqual([
      "stock_negative",
      "client_invoice_overdue",
      "schedule_delay",
      "diary_stale",
    ]);
  });
});
