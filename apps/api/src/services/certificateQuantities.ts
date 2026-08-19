export type CertificateQuantityStatus = "rascunho" | "submetido" | "aprovado";

export type CertificateLineQuantities = {
  measuredQty: number;
  proposedQty: number | null;
  certifiedQty: number | null;
  variationQty: number;
  contractPeriodQty: number;
};

/** Separa quantidade contratual da variação; certificado só após aprovação. */
export function certificateLineQuantities(args: {
  status: CertificateQuantityStatus;
  periodQty: number;
  previousQty: number;
  budgetedQty: number | null;
}): CertificateLineQuantities {
  const periodQty = Math.max(0, args.periodQty);
  const previousQty = Math.max(0, args.previousQty);
  const cumulativeQty = previousQty + periodQty;
  const overrunQty = args.budgetedQty === null ? 0 : Math.max(0, cumulativeQty - args.budgetedQty);
  const variationQty = Math.min(periodQty, overrunQty);
  const contractPeriodQty = Math.max(0, periodQty - variationQty);
  return {
    measuredQty: periodQty,
    proposedQty: args.status === "rascunho" ? null : periodQty,
    certifiedQty: args.status === "aprovado" ? contractPeriodQty : null,
    variationQty,
    contractPeriodQty,
  };
}
