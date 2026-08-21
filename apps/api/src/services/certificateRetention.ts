import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, measurementCertificates, projectContracts } from "../db/schema.js";
import { calculateBudgetTotals } from "./budgetTotals.js";
import { getCertificateDetail } from "./measurementEngine.js";

export type CertificateRetentionSnapshot = {
  grossCertifiedAmount: number;
  retentionRateSnapshot: number;
  retentionAmount: number;
  previousRetentionHeld: number;
  netDueAmount: number;
  releasedRetentionAmount: number;
};

export async function computeCertificateRetentionSnapshot(certificateId: string): Promise<CertificateRetentionSnapshot | null> {
  const detail = await getCertificateDetail(certificateId);
  if (!detail) return null;

  const [document] = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, detail.certificate.budgetDocumentId)).limit(1);
  const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, detail.certificate.projectId)).limit(1);

  const periodSubtotal = detail.lines.reduce((sum, line) => sum + line.periodValue, 0);
  const grossCertifiedAmount = calculateBudgetTotals(periodSubtotal, {
    siteCostsRate: Number(document?.siteCostsRate ?? 0),
    indirectCostsRate: Number(document?.indirectCostsRate ?? 0),
    contingenciasRate: Number(document?.contingenciasRate ?? 0),
    profitMarginRate: Number(document?.profitMarginRate ?? 0),
    ivaRate: 0,
  }).total;

  const retentionRateSnapshot = Number(contract?.retentionRate ?? 0);
  const retentionAmount = grossCertifiedAmount * retentionRateSnapshot;

  const previousRows = await db
    .select({ held: measurementCertificates.retentionAmount })
    .from(measurementCertificates)
    .where(and(
      eq(measurementCertificates.projectId, detail.certificate.projectId),
      eq(measurementCertificates.status, "aprovado"),
      lt(measurementCertificates.number, detail.certificate.number),
    ));
  const previousRetentionHeld = previousRows.reduce((sum, row) => sum + Number(row.held ?? 0), 0);
  const netDueAmount = grossCertifiedAmount - retentionAmount;

  return {
    grossCertifiedAmount,
    retentionRateSnapshot,
    retentionAmount,
    previousRetentionHeld,
    netDueAmount,
    releasedRetentionAmount: 0,
  };
}

export async function persistCertificateRetentionSnapshot(certificateId: string) {
  const snapshot = await computeCertificateRetentionSnapshot(certificateId);
  if (!snapshot) return null;
  const [updated] = await db
    .update(measurementCertificates)
    .set({
      grossCertifiedAmount: snapshot.grossCertifiedAmount.toFixed(2),
      retentionRateSnapshot: snapshot.retentionRateSnapshot.toString(),
      retentionAmount: snapshot.retentionAmount.toFixed(2),
      previousRetentionHeld: snapshot.previousRetentionHeld.toFixed(2),
      netDueAmount: snapshot.netDueAmount.toFixed(2),
      releasedRetentionAmount: snapshot.releasedRetentionAmount.toFixed(2),
    })
    .where(eq(measurementCertificates.id, certificateId))
    .returning();
  return { snapshot, certificate: updated };
}
