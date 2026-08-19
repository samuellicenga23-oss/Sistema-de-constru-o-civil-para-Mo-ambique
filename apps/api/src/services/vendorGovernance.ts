import { shiftWorkingDays } from "./schedulePlanning.js";

export type ProcurementLeadInput = {
  needBy: string;
  leadTimeDays: number;
  rfqDays?: number;
  approvalDays?: number;
  bufferDays?: number;
};

export function latestStartDate(input: ProcurementLeadInput): string {
  const total = Math.max(0, input.leadTimeDays) + Math.max(0, input.rfqDays ?? 0) + Math.max(0, input.approvalDays ?? 0) + Math.max(0, input.bufferDays ?? 0);
  return shiftWorkingDays(input.needBy, -total);
}

export function procurementStartOverdue(needBy: string, asOf: string, lead: Omit<ProcurementLeadInput, "needBy">): boolean {
  return latestStartDate({ needBy, ...lead }) < asOf;
}

export const VENDOR_GOVERNANCE_STATUSES = ["qualificado", "preferencial", "observacao", "bloqueado"] as const;
export type VendorGovernanceStatus = (typeof VENDOR_GOVERNANCE_STATUSES)[number];

export type SupplierScoreSample = {
  receiptCount: number;
  otifPct: number | null;
  acceptanceRatePct: number | null;
  rfqResponsePct: number | null;
  ncrCount: number;
  spend: number;
  openAp: number;
};

export function supplierScorecard(sample: SupplierScoreSample): { status: "ok" | "insufficient"; label: string; score: number | null } {
  if (sample.receiptCount < 3) {
    return { status: "insufficient", label: "Sem dados suficientes", score: null };
  }
  const otif = sample.otifPct ?? 0;
  const quality = sample.acceptanceRatePct ?? 0;
  const response = sample.rfqResponsePct ?? 0;
  const ncrPenalty = Math.min(30, sample.ncrCount * 5);
  const score = Math.max(0, Math.min(100, otif * 0.4 + quality * 0.3 + response * 0.2 + 10 - ncrPenalty));
  return { status: "ok", label: `${Math.round(score)}`, score };
}

export function assertVendorNotBlocked(status: string | null | undefined, reason?: string | null) {
  if (status === "bloqueado") {
    throw new Error(reason?.trim() ? `Fornecedor bloqueado: ${reason.trim()}` : "Fornecedor bloqueado");
  }
}
