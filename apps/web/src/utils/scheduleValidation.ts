import type { ScheduleTask } from "../api/schedule";

export type ScheduleIssueSeverity = "error" | "warning" | "info";

export type ScheduleIssue = {
  id: string;
  severity: ScheduleIssueSeverity;
  code: string;
  title: string;
  message: string;
  taskId?: string;
  taskCode?: string;
};

const LONG_DURATION_DAYS = 20;

/** Validações inspiradas em MS Project / DCMA 14-point, adaptadas ao SIGO. */
export function validateSchedule(tasks: ScheduleTask[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const leaves = tasks.filter((t) => !t.isSummary);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const successorCount = new Map<string, number>();
  for (const task of tasks) {
    if (task.predecessorTaskId) {
      successorCount.set(task.predecessorTaskId, (successorCount.get(task.predecessorTaskId) ?? 0) + 1);
    }
  }

  for (const task of leaves) {
    if (task.endDate < task.startDate) {
      issues.push({
        id: `end-before-start-${task.id}`,
        severity: "error",
        code: "DATA",
        title: "Fim antes do início",
        message: `«${task.name}» termina antes de começar.`,
        taskId: task.id,
        taskCode: task.code,
      });
    }

    if (task.durationDays > LONG_DURATION_DAYS) {
      issues.push({
        id: `long-duration-${task.id}`,
        severity: "warning",
        code: "DURAÇÃO",
        title: "Duração longa",
        message: `«${task.name}» tem ${task.durationDays} dias úteis (> ${LONG_DURATION_DAYS}). Considere subdividir.`,
        taskId: task.id,
        taskCode: task.code,
      });
    }

    if (task.status === "concluido" && task.progress < 100) {
      issues.push({
        id: `status-progress-${task.id}`,
        severity: "warning",
        code: "PROGRESSO",
        title: "Estado vs progresso",
        message: `«${task.name}» está concluída mas o progresso é ${task.progress.toFixed(2)}%.`,
        taskId: task.id,
        taskCode: task.code,
      });
    }

    if (task.progress >= 100 && task.status !== "concluido") {
      issues.push({
        id: `progress-status-${task.id}`,
        severity: "info",
        code: "PROGRESSO",
        title: "Progresso a 100%",
        message: `«${task.name}» tem 100% mas o estado é «${task.status}».`,
        taskId: task.id,
        taskCode: task.code,
      });
    }
  }

  // Open ends: folhas sem predecessora (exceto a primeira por ordem)
  const orderedLeaves = [...leaves].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < orderedLeaves.length; i++) {
    const task = orderedLeaves[i];
    if (i > 0 && !task.predecessorTaskId) {
      issues.push({
        id: `no-pred-${task.id}`,
        severity: "warning",
        code: "LÓGICA",
        title: "Sem predecessora",
        message: `«${task.name}» não tem ligação lógica (open end).`,
        taskId: task.id,
        taskCode: task.code,
      });
    }
    if (i < orderedLeaves.length - 1 && (successorCount.get(task.id) ?? 0) === 0) {
      issues.push({
        id: `no-succ-${task.id}`,
        severity: "info",
        code: "LÓGICA",
        title: "Sem sucessora",
        message: `«${task.name}» não é predecessora de nenhuma outra actividade.`,
        taskId: task.id,
        taskCode: task.code,
      });
    }
  }

  for (const task of tasks.filter((t) => t.isSummary)) {
    if (task.predecessorTaskId) {
      const pred = byId.get(task.predecessorTaskId);
      issues.push({
        id: `summary-logic-${task.id}`,
        severity: "warning",
        code: "WBS",
        title: "Lógica em fase-resumo",
        message: `A fase «${task.name}» tem predecessora${pred ? ` (${pred.code})` : ""}. Em MS Project a lógica deve ficar nas subactividades.`,
        taskId: task.id,
        taskCode: task.code,
      });
    }
  }

  if (leaves.length === 0 && tasks.length > 0) {
    issues.push({
      id: "no-leaves",
      severity: "error",
      code: "WBS",
      title: "Sem subactividades",
      message: "O cronograma só tem fases-resumo. Adicione subactividades executáveis.",
    });
  }

  const severityRank: Record<ScheduleIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function formatPredecessorLabel(task: ScheduleTask, byId: Map<string, ScheduleTask>): string {
  if (!task.predecessorTaskId) return "";
  const pred = byId.get(task.predecessorTaskId);
  if (!pred) return "";
  const type = task.dependencyType && task.dependencyType !== "FS" ? task.dependencyType : "";
  const lag = task.lagDays ? (task.lagDays > 0 ? `+${task.lagDays}` : `${task.lagDays}`) : "";
  return `${pred.code}${type}${lag}`;
}

/** Aceita "1.2", "1.2FS", "1.2FS+2", "1.2+2" */
export function parsePredecessorInput(
  raw: string,
  tasks: ScheduleTask[],
  currentId: string,
): { predecessorTaskId: string | null; dependencyType: "FS" | "SS" | "FF" | "SF"; lagDays: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { predecessorTaskId: null, dependencyType: "FS", lagDays: 0 };

  const match = text.match(/^([^\sFS]+?)(?:(FS|SS|FF|SF))?([+-]\d+)?$/i);
  if (!match) return { error: "Formato inválido. Use o código WBS, ex: 1.2 ou 1.2FS+2" };

  const code = match[1];
  const dependencyType = (match[2]?.toUpperCase() as "FS" | "SS" | "FF" | "SF") || "FS";
  const lagDays = match[3] ? Number(match[3]) : 0;
  const target = tasks.find((t) => t.code.toLowerCase() === code.toLowerCase() && t.id !== currentId);
  if (!target) return { error: `Código «${code}» não encontrado` };
  if (target.id === currentId) return { error: "Uma actividade não pode depender de si própria" };

  return { predecessorTaskId: target.id, dependencyType, lagDays };
}
