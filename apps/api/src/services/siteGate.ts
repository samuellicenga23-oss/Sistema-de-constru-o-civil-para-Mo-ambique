import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments } from "../db/schema.js";
import { assertProjectOwned } from "./accessControl.js";

/**
 * Gestão de obra (cronograma, diário, compras) exige pelo menos um orçamento
 * aprovado no projecto — alinhado com a lista /gestao (readyForSite).
 */
export async function assertApprovedOrcamentoForSite(projectId: string, companyId: string) {
  const project = await assertProjectOwned(projectId, companyId);
  if (!project) return { ok: false as const, error: "Projecto não encontrado", status: 404 as const };

  const [approved] = await db
    .select({ id: budgetDocuments.id })
    .from(budgetDocuments)
    .where(
      and(
        eq(budgetDocuments.projectId, projectId),
        eq(budgetDocuments.documentType, "orcamento"),
        eq(budgetDocuments.status, "aprovado"),
      ),
    )
    .limit(1);

  if (!approved) {
    return {
      ok: false as const,
      error: "A gestão da obra exige um orçamento aprovado. Aprove o orçamento antes de continuar.",
      status: 409 as const,
    };
  }

  return { ok: true as const, project, budgetDocumentId: approved.id };
}
