export type ProjectControlCheck = {
  id: "dados" | "fonte" | "medicao" | "orcamento" | "planeamento" | "execucao";
  label: string;
  status: "concluido" | "actual" | "pendente" | "bloqueado";
};

export type ProjectWorkflowControl = {
  score: number;
  mode: "automatico" | "assistido" | "bloqueado";
  completed: number;
  total: number;
  checks: ProjectControlCheck[];
};

/**
 * Converte evidências dos módulos numa única sequência operacional. Não altera dados nem toma
 * decisões comerciais: apenas escolhe o próximo passo seguro e mede a cobertura já confirmada.
 */
export function buildProjectWorkflowControl(
  sourceChecks: ProjectControlCheck[],
  severities: Array<"info" | "warning" | "error">,
): ProjectWorkflowControl {
  const checks = sourceChecks.map((check) => ({ ...check }));
  const blockedIndex = checks.findIndex((check) => check.status === "bloqueado");
  checks.forEach((check, index) => {
    if (check.status !== "concluido" && index !== blockedIndex) check.status = "pendente";
  });
  if (blockedIndex < 0) {
    const next = checks.find((check) => check.status === "pendente");
    if (next) next.status = "actual";
  }
  const completed = checks.filter((check) => check.status === "concluido").length;
  const mode: ProjectWorkflowControl["mode"] = severities.includes("error")
    ? "bloqueado"
    : severities.includes("warning")
      ? "assistido"
      : "automatico";
  return {
    score: checks.length ? Math.round((completed / checks.length) * 100) : 0,
    mode,
    completed,
    total: checks.length,
    checks,
  };
}
