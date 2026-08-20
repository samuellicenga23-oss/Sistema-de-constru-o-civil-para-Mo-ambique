import { describe, expect, it } from "vitest";
import { faseQueryFor, resolveProjectFase } from "../src/components/ProjectWorkspaceNav";

describe("project workspace fase", () => {
  it("sem query abre visão geral", () => {
    expect(resolveProjectFase(null)).toBe("visao");
    expect(resolveProjectFase("")).toBe("visao");
  });

  it("preserva levantamentos e orçamentos no URL", () => {
    expect(resolveProjectFase("medicao")).toBe("medicao");
    expect(resolveProjectFase("levantamentos")).toBe("medicao");
    expect(resolveProjectFase("orcamento")).toBe("orcamento");
    expect(resolveProjectFase("orcamentos")).toBe("orcamento");
    expect(resolveProjectFase("gestao")).toBe("gestao");
  });

  it("serializa query estável", () => {
    expect(faseQueryFor("visao")).toBe("");
    expect(faseQueryFor("medicao")).toBe("?fase=medicao");
    expect(faseQueryFor("orcamento")).toBe("?fase=orcamento");
    expect(faseQueryFor("gestao")).toBe("?fase=gestao");
  });
});
