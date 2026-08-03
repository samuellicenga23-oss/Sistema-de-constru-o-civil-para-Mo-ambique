export type DocumentType = "medicao" | "orcamento";

export type DocumentReadinessItem = {
  kind: string;
  description: string;
  unit: string | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
};

export type DocumentReadiness = {
  ready: boolean;
  measuredItems: number;
  missingUnit: number;
  missingPrice: number;
  blockers: string[];
};

/**
 * Regras mínimas antes de um documento entrar no circuito de aprovação.
 * Itens com quantidade zero não fazem parte da proposta/medição e não bloqueiam
 * trabalhos que não se aplicam à obra.
 */
export function evaluateDocumentReadiness(
  documentType: DocumentType,
  items: DocumentReadinessItem[],
): DocumentReadiness {
  const measured = items.filter((item) => item.kind === "item" && Number(item.quantity ?? 0) > 0);
  const missingUnit = measured.filter((item) => !item.unit?.trim()).length;
  const missingPrice = documentType === "orcamento"
    ? measured.filter((item) => !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice ?? 0) <= 0).length
    : 0;
  const blockers: string[] = [];

  if (measured.length === 0) blockers.push("Introduza pelo menos uma quantidade maior que zero");
  if (missingUnit > 0) blockers.push(`${missingUnit} item(ns) medido(s) sem unidade`);
  if (missingPrice > 0) blockers.push(`${missingPrice} item(ns) medido(s) sem preço unitário`);

  return {
    ready: blockers.length === 0,
    measuredItems: measured.length,
    missingUnit,
    missingPrice,
    blockers,
  };
}

export function documentLockedMessage(status: string) {
  return status === "aprovado"
    ? "Documento aprovado e protegido. Crie uma nova revisão para alterar quantidades ou preços."
    : "Documento submetido e protegido. Devolva-o a rascunho antes de editar."
}
