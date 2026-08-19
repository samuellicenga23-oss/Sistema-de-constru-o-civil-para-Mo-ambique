import { describe, expect, it } from "vitest";
import { pipelineMetrics, quoteStatusToPipelineStage } from "../src/utils/commercialPipeline";

describe("pipeline comercial", () => {
  it("mapeia proposta e ganho/perdido sem duplicar contrato", () => {
    expect(quoteStatusToPipelineStage("rascunho")).toBe("lead");
    expect(quoteStatusToPipelineStage("enviada")).toBe("proposta");
    expect(quoteStatusToPipelineStage("aprovada")).toBe("ganho");
    expect(quoteStatusToPipelineStage("aprovada", true)).toBe("contrato");
    expect(quoteStatusToPipelineStage("aprovada", true, true)).toBe("projecto");
    expect(quoteStatusToPipelineStage("rejeitada")).toBe("perdido");
  });

  it("win rate ignora pipeline aberto", () => {
    const metrics = pipelineMetrics([
      { status: "enviada", totalAmount: 100 },
      { status: "aprovada", totalAmount: 200, hasEngagement: true },
      { status: "rejeitada", totalAmount: 50 },
    ]);
    expect(metrics.pipelineValue).toBe(100);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.activeContracts).toBe(1);
  });
});
