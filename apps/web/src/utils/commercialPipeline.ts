export type CommercialPipelineStage = "lead" | "qualificado" | "proposta" | "negociacao" | "ganho" | "perdido" | "contrato" | "projecto";

export function quoteStatusToPipelineStage(status: string, hasEngagement = false, hasProject = false): CommercialPipelineStage {
  if (hasProject) return "projecto";
  if (hasEngagement) return "contrato";
  if (status === "aprovada") return "ganho";
  if (status === "rejeitada" || status === "cancelada") return "perdido";
  if (status === "enviada") return "proposta";
  return "lead";
}

export function pipelineMetrics(rows: Array<{ status: string; totalAmount: number; hasEngagement?: boolean; hasProject?: boolean }>) {
  const stages = rows.map((row) => ({ ...row, stage: quoteStatusToPipelineStage(row.status, row.hasEngagement, row.hasProject) }));
  const open = stages.filter((row) => !["ganho", "perdido", "contrato", "projecto"].includes(row.stage));
  const decided = stages.filter((row) => ["ganho", "perdido", "contrato", "projecto"].includes(row.stage));
  const won = stages.filter((row) => ["ganho", "contrato", "projecto"].includes(row.stage));
  return {
    pipelineValue: open.reduce((sum, row) => sum + row.totalAmount, 0),
    pendingProposals: stages.filter((row) => row.stage === "proposta" || row.stage === "negociacao").length,
    winRate: decided.length ? won.length / decided.length : null,
    activeContracts: stages.filter((row) => row.stage === "contrato" || row.stage === "projecto").length,
  };
}
