import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { paymentMethodCatalog } from "../db/schema.js";
import { MZ_PAYMENT_METHODS, validateNuitMz } from "@sigo/shared";

export const PRACTICE_CLIENT_TYPES = ["particular", "empresa", "ong", "publico", "outro"] as const;
export const PRACTICE_TENDER_STATUSES = ["rascunho", "em_preparacao", "submetido", "adjudicado", "perdido", "cancelado"] as const;

export function validatePracticeClientNuit(
  nuit: string | null | undefined,
  nuitForeign: boolean,
): { ok: true; nuit: string | null } | { ok: false; error: string } {
  const check = validateNuitMz(nuit, { foreign: nuitForeign });
  if (!check.ok) return check;
  return { ok: true, nuit: check.nuit };
}

export function validateQuoteFxRate(
  currency: string,
  fxRate: number | null | undefined,
): { ok: true; fxRate: string | null } | { ok: false; error: string } {
  if (currency === "MZN") {
    if (fxRate != null && fxRate > 0) return { ok: false, error: "Taxa FX só se aplica quando a moeda não é MZN." };
    return { ok: true, fxRate: null };
  }
  if (fxRate == null || !Number.isFinite(fxRate) || fxRate <= 0) {
    return { ok: false, error: "Indique a taxa FX explícita para propostas em moeda estrangeira." };
  }
  return { ok: true, fxRate: fxRate.toFixed(6) };
}

export async function validatePaymentMethodCodes(
  codes: string[] | undefined,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const list = [...new Set((codes ?? []).map((c) => c.trim()).filter(Boolean))];
  if (!list.length) return { ok: true, codes: [] };
  const catalogRows = await db
    .select({ code: paymentMethodCatalog.code })
    .from(paymentMethodCatalog)
    .where(inArray(paymentMethodCatalog.code, list));
  const known = new Set([...catalogRows.map((r) => r.code), ...MZ_PAYMENT_METHODS.map((m) => m.code)]);
  const unknown = list.filter((c) => !known.has(c));
  if (unknown.length) return { ok: false, error: `Meios de pagamento desconhecidos: ${unknown.join(", ")}` };
  return { ok: true, codes: list };
}
