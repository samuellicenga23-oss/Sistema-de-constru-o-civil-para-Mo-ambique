import { describe, expect, it } from "vitest";
import { buildProjectWorkflowControl, type ProjectControlCheck } from "../src/services/projectWorkflowControl.js";

const checks = (statuses: ProjectControlCheck["status"][]): ProjectControlCheck[] =>
  statuses.map((status, index) => ({
    id: (["dados", "fonte", "medicao", "orcamento", "planeamento", "execucao"] as const)[index],
    label: `Etapa ${index + 1}`,
    status,
  }));

describe("controlo operacional do projecto", () => {
  it("mostra uma única próxima etapa e calcula a cobertura confirmada", () => {
    const result = buildProjectWorkflowControl(
      checks(["concluido", "actual", "actual", "pendente", "pendente", "pendente"]),
      [],
    );
    expect(result.mode).toBe("automatico");
    expect(result.score).toBe(17);
    expect(result.checks.map((item) => item.status)).toEqual([
      "concluido", "actual", "pendente", "pendente", "pendente", "pendente",
    ]);
  });

  it("preserva um bloqueio e não apresenta uma etapa concorrente", () => {
    const result = buildProjectWorkflowControl(
      checks(["concluido", "bloqueado", "actual", "pendente", "pendente", "pendente"]),
      ["error"],
    );
    expect(result.mode).toBe("bloqueado");
    expect(result.checks.filter((item) => item.status === "actual")).toHaveLength(0);
    expect(result.checks[1].status).toBe("bloqueado");
  });

  it("exige confirmação quando há avisos sem bloquear o fluxo", () => {
    const result = buildProjectWorkflowControl(checks(Array(6).fill("concluido")), ["warning"]);
    expect(result.mode).toBe("assistido");
    expect(result.score).toBe(100);
  });
});
